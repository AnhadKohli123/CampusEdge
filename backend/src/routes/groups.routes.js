import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isPublished, maskStatus } from '../services/results.service.js';
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
    `SELECT g.id, g.name, g.group_lead_id, g.avg_cgpa, g.status, g.gender, g.semester, g.created_at,
            COALESCE(
              json_agg(
                json_build_object('id', s.id, 'name', s.name, 'email', s.email,
                              'cgpa', s.cgpa, 'gender', s.gender)
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

/**
 * Membership is frozen once a room has been handed out: dropping a member from
 * an allotted group would leave a room short of occupants without anyone
 * noticing. Changes after allotment go through an admin swap instead.
 */
async function assertMembershipOpen(group) {
  if (group.status === 'active') return;

  // Both 'allotted' and 'waitlist' mean the batch has already ranked this
  // group, so its roster (and therefore its average CGPA) must stay put.
  // Before results are published the reason has to stay vague: "already
  // allotted" would tell the student they got a room, and "waitlisted" would
  // tell them they did not.
  const published = await isPublished(group.semester);
  if (!published) {
    throw conflict('Group changes are closed while allotment is being processed');
  }
  throw conflict(
    group.status === 'allotted'
      ? 'This group is already allotted; membership is locked'
      : 'This group has been through allotment; ask the hostel office to reopen it'
  );
}

/**
 * Hostels are single-gender buildings, so a group has to be single-gender too
 * -- a mixed group could not be placed anywhere. Checked when a member is added
 * and again when an invite is accepted.
 */
async function assertGenderMatches(client, groupGender, studentId) {
  const { rows } = await client.query('SELECT gender FROM students WHERE id = $1', [
    studentId,
  ]);
  if (rows.length === 0) throw notFound('Student not found');

  const studentGender = rows[0].gender;
  if (!studentGender) {
    throw badRequest('That student has not set their gender yet');
  }
  if (groupGender && studentGender !== groupGender) {
    throw badRequest(
      `This is a ${groupGender === 'male' ? "boys'" : "girls'"} group; ` +
        'hostels are single-gender so groups cannot be mixed'
    );
  }
  return studentGender;
}

/** Staff see anything; a student sees only a group they belong to. */
async function assertCanViewGroup(user, groupId) {
  if (!user) throw forbidden('Sign in to view a group');
  if (user.role === 'admin' || user.role === 'caretaker') return;

  const { rows } = await query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND student_id = $2',
    [groupId, user.sub]
  );
  if (rows.length === 0) throw forbidden('You can only view your own group');
}

/** Throws unless the caller leads the group (admins bypass). */
async function assertGroupLead(user, groupId) {
  const { rows } = await query(
    'SELECT group_lead_id, status, semester, gender FROM groups WHERE id = $1',
    [groupId]
  );
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
  memberIds: z.array(z.string().uuid()).max(config.maxGroupSize).optional(),
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
    if (allMembers.length > config.maxGroupSize) {
      throw badRequest(`A group may have at most ${config.maxGroupSize} members`);
    }

    const group = await withTransaction(async (client) => {
      // The lead sets the group's gender; everyone else must match it.
      const leadGender = await assertGenderMatches(client, null, leadId);

      const { rows } = await client.query(
        `INSERT INTO groups (name, group_lead_id, gender, semester)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [name ?? null, leadId, leadGender, semester]
      );
      const groupId = rows[0].id;

      for (const studentId of allMembers) {
        if (studentId !== leadId) {
          await assertGenderMatches(client, leadGender, studentId);
        }
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

/**
 * The full group roster with average CGPAs. Staff only -- for a student this is
 * a leaderboard of who is ahead of them in the queue, which is not theirs to
 * see. Students use /groups/mine instead.
 */
router.get(
  '/',
  requireRole('admin', 'caretaker'),
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

    const group = await loadGroup(rows[0].id);
    const published = await isPublished(semester);
    res.json({
      group: { ...group, status: maskStatus(group.status, published) },
      resultsPublished: published,
    });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertCanViewGroup(req.user, req.params.id);

    const group = await loadGroup(req.params.id);
    if (!group) throw notFound('Group not found');

    const isStaff = req.user.role === 'admin' || req.user.role === 'caretaker';
    if (isStaff) return res.json({ group });

    const published = await isPublished(group.semester);
    res.json({
      group: { ...group, status: maskStatus(group.status, published) },
      resultsPublished: published,
    });
  })
);

const addMemberSchema = z.object({ studentId: z.string().uuid() });

router.post(
  '/:id/members',
  requireAuth,
  validate(addMemberSchema),
  asyncHandler(async (req, res) => {
    const groupId = req.params.id;
    const existing = await assertGroupLead(req.user, groupId);
    await assertMembershipOpen(existing);

    const group = await withTransaction(async (client) => {
      await assertGenderMatches(client, existing.gender, req.body.studentId);
      // Lock the group row so two concurrent invites cannot both see 3 members.
      await client.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [groupId]);

      const { rows: countRows } = await client.query(
        'SELECT COUNT(*)::int AS n FROM group_members WHERE group_id = $1',
        [groupId]
      );
      if (countRows[0].n >= config.maxGroupSize) {
        throw conflict(`Group is already full (${config.maxGroupSize} members)`);
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
    await assertMembershipOpen(group);

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
