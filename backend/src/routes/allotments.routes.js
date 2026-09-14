import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden } from '../utils/errors.js';
import { isPublished } from '../services/results.service.js';

const router = Router();

const ALLOTMENT_SELECT = `
  SELECT a.id, a.semester, a.matched_rank, a.allotted_at,
         g.id AS group_id, g.name AS group_name, g.avg_cgpa,
         r.room_number, r.id AS room_id,
         h.name AS hostel_name, h.building_code,
         rt.name AS room_type_name, rt.capacity
    FROM allotments a
    JOIN groups g      ON g.id = a.group_id
    JOIN rooms r       ON r.id = a.room_id
    JOIN hostels h     ON h.id = r.hostel_id
    JOIN room_types rt ON rt.id = r.room_type_id
`;

const listSchema = z.object({
  semester: z.string().trim().optional(),
  hostelId: z.string().uuid().optional(),
});

/**
 * Every allotment for a semester. Staff only: to a student this is the full
 * list of who got which room, which is not theirs to browse. Students use
 * /allotments/mine.
 */
router.get(
  '/',
  requireRole('admin', 'caretaker'),
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const semester = req.query.semester ?? config.currentSemester;
    const { rows } = await query(
      `${ALLOTMENT_SELECT}
        WHERE a.semester = $1
          AND ($2::uuid IS NULL OR h.id = $2)
        ORDER BY h.name, r.room_number`,
      [semester, req.query.hostelId ?? null]
    );
    res.json({ semester, allotments: rows });
  })
);

/**
 * The student's own result.
 *
 * Nothing about the outcome is returned until an admin publishes results for
 * the semester -- not the room, not whether they were waitlisted. Before that
 * the honest answer is "we have your preferences, results are not out".
 */
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const semester = req.query.semester ?? config.currentSemester;

    const { rows: groupRows } = await query(
      `SELECT g.id, g.name, g.status, g.avg_cgpa
         FROM groups g
         JOIN group_members gm ON gm.group_id = g.id
        WHERE gm.student_id = $1 AND g.semester = $2`,
      [req.user.sub, semester]
    );

    if (groupRows.length === 0) {
      return res.json({
        semester,
        resultsPublished: await isPublished(semester),
        group: null,
        allotment: null,
        message: `You are not in a group for ${semester}.`,
      });
    }

    const group = groupRows[0];
    const published = await isPublished(semester);

    const { rows: prefRows } = await query(
      'SELECT COUNT(*)::int AS n FROM preferences WHERE group_id = $1',
      [group.id]
    );
    const preferenceCount = prefRows[0].n;

    if (!published) {
      // Deliberately omits status and allotment: both would reveal the outcome.
      return res.json({
        semester,
        resultsPublished: false,
        group: { id: group.id, name: group.name, avg_cgpa: group.avg_cgpa },
        allotment: null,
        preferenceCount,
        message:
          preferenceCount > 0
            ? 'Your preferences are submitted. Results have not been published yet.'
            : 'Results have not been published yet, and your group has not submitted preferences.',
      });
    }

    const { rows } = await query(
      `${ALLOTMENT_SELECT} WHERE a.group_id = $1 AND a.semester = $2`,
      [group.id, semester]
    );
    const allotment = rows[0] ?? null;

    res.json({
      semester,
      resultsPublished: true,
      group,
      allotment,
      preferenceCount,
      message: allotment
        ? `Allotted ${allotment.hostel_name} room ${allotment.room_number}.`
        : group.status === 'waitlist'
          ? 'Your group is waitlisted -- no room matched your preferences.'
          : 'No room was allotted to your group.',
    });
  })
);

/** A specific group's allotment: its own members, or staff. */
router.get(
  '/group/:groupId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const semester = req.query.semester ?? config.currentSemester;
    const isStaff = req.user.role === 'admin' || req.user.role === 'caretaker';

    if (!isStaff) {
      const { rows } = await query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND student_id = $2',
        [req.params.groupId, req.user.sub]
      );
      if (rows.length === 0) throw forbidden('You can only view your own group');
      if (!(await isPublished(semester))) {
        return res.json({ allotment: null, resultsPublished: false });
      }
    }

    const { rows } = await query(
      `${ALLOTMENT_SELECT} WHERE a.group_id = $1 AND a.semester = $2`,
      [req.params.groupId, semester]
    );
    res.json({ allotment: rows[0] ?? null, resultsPublished: true });
  })
);

export default router;
