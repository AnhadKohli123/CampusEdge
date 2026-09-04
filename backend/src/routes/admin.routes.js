import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getOccupancy, runAllotment } from '../services/allotment.service.js';

const router = Router();

// Everything below is staff-only.
router.use(requireRole('admin', 'caretaker'));

const allocateSchema = z.object({
  semester: z.string().min(1).max(32).trim().default(config.currentSemester),
});

/**
 * Trigger the batch job. Runs inline: the whole allocation is one SERIALIZABLE
 * transaction that finishes in well under a request timeout at college scale
 * (a few thousand groups). If it ever outgrows that, this handler is the
 * natural place to push the job onto a Bull queue and return 202 + a run id --
 * allotment_runs already gives the client something to poll.
 */
router.post(
  '/allocate',
  validate(allocateSchema),
  asyncHandler(async (req, res) => {
    const summary = await runAllotment({
      semester: req.body.semester,
      triggeredBy: req.user.sub,
    });
    res.json({ summary });
  })
);

router.get(
  '/occupancy',
  asyncHandler(async (req, res) => {
    const semester = req.query.semester ?? config.currentSemester;
    const rows = await getOccupancy(semester);

    const totals = rows.reduce(
      (acc, row) => {
        acc.totalRooms += row.total_rooms;
        acc.allottedRooms += row.allotted_rooms;
        acc.maintenanceRooms += row.maintenance_rooms;
        return acc;
      },
      { totalRooms: 0, allottedRooms: 0, maintenanceRooms: 0 }
    );

    res.json({ semester, breakdown: rows, totals });
  })
);

/** Recent batch runs -- the audit trail for "who ran allotment and when". */
router.get(
  '/allotment-runs',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT ar.id, ar.semester, ar.status, ar.started_at, ar.finished_at,
              ar.summary, ar.error,
              a.name AS triggered_by_name, a.email AS triggered_by_email
         FROM allotment_runs ar
         LEFT JOIN admins a ON a.id = ar.triggered_by
        WHERE ($1::text IS NULL OR ar.semester = $1)
        ORDER BY ar.started_at DESC
        LIMIT 20`,
      [req.query.semester ?? null]
    );
    res.json({ runs: rows });
  })
);

/** Waitlisted groups, highest CGPA first -- who to help next. */
router.get(
  '/waitlist',
  asyncHandler(async (req, res) => {
    const semester = req.query.semester ?? config.currentSemester;
    const { rows } = await query(
      `SELECT g.id, g.name, g.avg_cgpa, COUNT(gm.id)::int AS member_count
         FROM groups g
         LEFT JOIN group_members gm ON gm.group_id = g.id
        WHERE g.semester = $1 AND g.status = 'waitlist'
        GROUP BY g.id
        ORDER BY g.avg_cgpa DESC NULLS LAST, g.created_at ASC`,
      [semester]
    );
    res.json({ semester, waitlist: rows });
  })
);

export default router;
