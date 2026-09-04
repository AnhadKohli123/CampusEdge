import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

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

router.get(
  '/',
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

/** What the logged-in student sees on the result screen. */
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
        group: null,
        allotment: null,
        message: `You are not in a group for ${semester}.`,
      });
    }

    const group = groupRows[0];
    const { rows } = await query(
      `${ALLOTMENT_SELECT} WHERE a.group_id = $1 AND a.semester = $2`,
      [group.id, semester]
    );

    const allotment = rows[0] ?? null;
    res.json({
      semester,
      group,
      allotment,
      // Roommates are useful on this screen and nowhere else.
      message: allotment
        ? `Allotted ${allotment.hostel_name} room ${allotment.room_number}.`
        : group.status === 'waitlist'
          ? 'Your group is waitlisted -- no room matched your preferences.'
          : 'Allotment has not run yet for this semester.',
    });
  })
);

router.get(
  '/group/:groupId',
  asyncHandler(async (req, res) => {
    const semester = req.query.semester ?? config.currentSemester;
    const { rows } = await query(
      `${ALLOTMENT_SELECT} WHERE a.group_id = $1 AND a.semester = $2`,
      [req.params.groupId, semester]
    );
    res.json({ allotment: rows[0] ?? null });
  })
);

export default router;
