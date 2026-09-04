import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

const router = Router();

/** Recompute the stored average from current member CGPAs. */
async function recalcAvgCgpa(client, groupId) {
  const { rows } = await client.query(
    `UPDATE groups g
        SET avg_cgpa = sub.avg_cgpa
       FROM (SELECT ROUND(AVG(s.cgpa), 2) AS avg_cgpa
               FROM group_members gm
               JOIN students s ON s.id = gm.student_id
              WHERE gm.group_id = $1) sub
      WHERE g.id = $1
      RETURNING g.avg_cgpa`,
    [groupId]
  );
  return rows[0]?.avg_cgpa ?? null;
}

async function loadGroup(groupId) {
  const { rows } = await query(
    `SELECT g.id, g.name, g.group_lead_id, g.avg_cgpa, g.status, g.semester, g.created_at,
            COALESCE(
              json_agg(
                json_build_object('id', s.id, 'name', s.name, 'email', s.email, 'cgpa', s.cgpa)
                ORDER BY s.name
              ) FILTER (WHERE s.id IS NOT NULL), '[]'
            ) AS members
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.id
       LEFT JOIN students s       ON s.id = gm.student_id
      WHERE g.id = $1
      GROUP BY g.id`,
    [groupId]
  );
  return rows[0] ?? null;
}

/** Throws unless the caller leads the group (admins bypass). */
async function assertGroupLead(user, groupId) {
  const { rows } = await query('SELECT group_lead_id, status FROM groups WHERE id = $1', [
    groupId,
  ]);
  if (rows.length === 0) throw notFound('Group not found');
  if (user.role !== 'admin' && rows[0].group_lead_id !== user.sub) {
    throw forbidden('Only the group lead can modify this group');
  }
  return rows[0];
}

const createSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  semester: z.string().min(1).max(32).trim().default(config.currentSemester),
  // Optional: seed the group with members at creation time.
  memberIds: z.array(z.string().uuid()).max(config.groupSize).optional(),
});

router.post(
  '/',
  requireAuth,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { name, semester, memberIds = [] } = req.body;
    const leadId = req.user.sub;

    // The lead is always a member; de-duplicate if they also listed themselves.
    const allMembers = [...new Set([leadId, ...memberIds])];
    if (allMembers.length > config.groupSize) {
      throw badRequest(`A group may have at most ${config.groupSize} members`);
    }

    const group = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO groups (name, group_lead_id, semester)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [name ?? null, leadId, semester]
      );
      const groupId = rows[0].id;

      for (const studentId of allMembers) {
        await client.query(
          'INSERT INTO group_members (group_id, student_id) VALUES ($1, $2)',
          [groupId, studentId]
        );
      }
      await recalcAvgCgpa(client, groupId);
      return groupId;
    });

    res.status(201).json({ group: await loadGroup(group) });
  })
);

const listSchema = z.object({
  semester: z.string().trim().optional(),
  status: z.enum(['active', 'allotted', 'waitlist']).optional(),
});

router.get(
  '/',
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { semester, status } = req.query;
    const { rows } = await query(
      `SELECT g.id, g.name, g.avg_cgpa, g.status, g.semester, g.created_at,
              COUNT(gm.id)::int AS member_count
         FROM groups g
         LEFT JOIN group_members gm ON gm.group_id = g.id
        WHERE ($1::text IS NULL OR g.semester = $1)
          AND ($2::text IS NULL OR g.status = $2)
        GROUP BY g.id
        ORDER BY g.avg_cgpa DESC NULLS LAST, g.created_at ASC`,
      [semester ?? null, status ?? null]
    );
    res.json({ groups: rows });
  })
);

/** The current student's group for a semester -- drives the student portal. */
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const semester = req.query.semester ?? config.currentSemester;
    const { rows } = await query(
      `SELECT g.id
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id
        WHERE gm.student_id = $1 AND g.semester = $2`,
      [req.user.sub, semester]
    );
    if (rows.length === 0) return res.json({ group: null });
    res.json({ group: await loadGroup(rows[0].id) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const group = await loadGroup(req.params.id);
    if (!group) throw notFound('Group not found');
    res.json({ group });
  })
);

const addMemberSchema = z.object({ studentId: z.string().uuid() });

router.post(
  '/:id/members',
  requireAuth,
  validate(addMemberSchema),
  asyncHandler(async (req, res) => {
    const groupId = req.params.id;
    await assertGroupLead(req.user, groupId);

    const group = await withTransaction(async (client) => {
      // Lock the group row so two concurrent invites cannot both see 3 members.
      await client.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [groupId]);

      const { rows: countRows } = await client.query(
        'SELECT COUNT(*)::int AS n FROM group_members WHERE group_id = $1',
        [groupId]
      );
      if (countRows[0].n >= config.groupSize) {
        throw conflict(`Group is already full (${config.groupSize} members)`);
      }

      await client.query(
        'INSERT INTO group_members (group_id, student_id) VALUES ($1, $2)',
        [groupId, req.body.studentId]
      );
      await recalcAvgCgpa(client, groupId);
      return groupId;
    });

    res.status(201).json({ group: await loadGroup(group) });
  })
);

router.delete(
  '/:id/members/:studentId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id: groupId, studentId } = req.params;
    const group = await assertGroupLead(req.user, groupId);

    if (group.group_lead_id === studentId) {
      throw badRequest('The group lead cannot be removed; delete the group instead');
    }

    await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        'DELETE FROM group_members WHERE group_id = $1 AND student_id = $2',
        [groupId, studentId]
      );
      if (rowCount === 0) throw notFound('That student is not in this group');
      await recalcAvgCgpa(client, groupId);
    });

    res.json({ group: await loadGroup(groupId) });
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = req.params.id;
    const group = await assertGroupLead(req.user, groupId);
    if (group.status === 'allotted') {
      throw conflict('An allotted group cannot be deleted; ask an admin for a swap');
    }
    await query('DELETE FROM groups WHERE id = $1', [groupId]);
    res.status(204).end();
  })
);

export default router;
