import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getOccupancy, runAllotment } from '../services/allotment.service.js';
import { getSettings, setPublished } from '../services/results.service.js';

const router = Router();

/**
 * Role split:
 *   admin     -- college-wide. Runs the allotment, sees every hostel.
 *   caretaker -- responsible for one hostel. Sees the queue and their own
 *                hostel's occupancy, flags rooms for maintenance, but does not
 *                run the batch job for the whole college.
 */
router.use(requireRole('admin', 'caretaker'));

/** A caretaker's view is pinned to their hostel; an admin sees everything. */
const scopedHostelId = (user) =>
  user.role === 'caretaker' && user.hostelId ? user.hostelId : null;

// ---------------------------------------------------------------------------
// The allotment queue
// ---------------------------------------------------------------------------

// Whitelisted so the sort key can never reach SQL as user input.
const SORT_COLUMNS = {
  cgpa: 'm.avg_cgpa',
  name: 'g.name',
  members: 'm.member_count',
  status: 'g.status',
  created: 'g.created_at',
  preferences: 'p.preference_count',
};

const queueSchema = z.object({
  semester: z.string().trim().optional(),
  status: z.enum(['active', 'allotted', 'waitlist']).optional(),
  search: z.string().trim().optional(),
  sort: z.enum(Object.keys(SORT_COLUMNS)).default('cgpa'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * Every group for a semester with the numbers an admin needs to decide whether
 * to run the batch: average CGPA, how many members, whether preferences were
 * submitted, and where they ended up.
 *
 * Default sort is CGPA descending -- the order the allotment will actually
 * process them in, so this doubles as a preview of the queue.
 */
router.get(
  '/groups',
  validate(queueSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { semester = config.currentSemester, status, search, sort, order, limit } =
      req.query;

    const direction = order === 'asc' ? 'ASC' : 'DESC';
    // CGPA ties are resolved first-come-first-served, matching the algorithm.
    const orderBy = `${SORT_COLUMNS[sort]} ${direction} NULLS LAST, g.created_at ASC`;

    const { rows } = await query(
      `SELECT g.id, g.name, g.status, g.gender, g.created_at,
              m.member_count,
              m.avg_cgpa,
              p.preference_count,
              lead.name  AS lead_name,
              lead.email AS lead_email,
              h.name AS hostel_name,
              r.room_number,
              a.matched_rank
         FROM groups g
         -- Averaged live from current member CGPAs rather than read from
         -- groups.avg_cgpa, which is only written when allotment runs. This
         -- way the queue shows what the next run will actually rank on.
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS member_count, ROUND(AVG(s.cgpa), 2) AS avg_cgpa
             FROM group_members gm
             JOIN students s ON s.id = gm.student_id
            WHERE gm.group_id = g.id
         ) m ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS preference_count
             FROM preferences pref WHERE pref.group_id = g.id
         ) p ON TRUE
         LEFT JOIN students lead ON lead.id = g.group_lead_id
         LEFT JOIN allotments a  ON a.group_id = g.id AND a.semester = g.semester
         LEFT JOIN rooms r       ON r.id = a.room_id
         LEFT JOIN hostels h     ON h.id = r.hostel_id
        WHERE g.semester = $1
          AND ($2::text IS NULL OR g.status = $2)
          AND ($3::text IS NULL OR g.name ILIKE '%' || $3 || '%'
                                OR lead.name ILIKE '%' || $3 || '%'
                                OR lead.email ILIKE '%' || $3 || '%')
        ORDER BY ${orderBy}
        LIMIT $4`,
      [semester, status ?? null, search ?? null, limit]
    );

    // Counts for the whole semester, not just the filtered page.
    const { rows: totals } = await query(
      `SELECT g.status, COUNT(*)::int AS n
         FROM groups g WHERE g.semester = $1 GROUP BY g.status`,
      [semester]
    );
    const counts = { active: 0, allotted: 0, waitlist: 0 };
    for (const row of totals) counts[row.status] = row.n;

    // How many groups the next run could actually place: at least one member
    // and at least one preference. Size no longer gates eligibility -- a pair
    // is matched to a 2-seater, a lone student to a single.
    const { rows: readyRows } = await query(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT g.id
           FROM groups g
           JOIN group_members gm ON gm.group_id = g.id
          WHERE g.semester = $1 AND g.status = 'active'
          GROUP BY g.id
         HAVING COUNT(gm.id) > 0
            AND EXISTS (SELECT 1 FROM preferences p WHERE p.group_id = g.id)
       ) ready`,
      [semester]
    );

    const settings = await getSettings(semester);

    res.json({
      semester,
      groups: rows,
      counts,
      readyToAllot: readyRows[0].n,
      maxGroupSize: config.maxGroupSize,
      resultsPublishedAt: settings.results_published_at,
      publishedByName: settings.published_by_name,
      sort,
      order,
    });
  })
);

// ---------------------------------------------------------------------------
// Running the batch
// ---------------------------------------------------------------------------

const allocateSchema = z.object({
  semester: z.string().min(1).max(32).trim().default(config.currentSemester),
});

/**
 * Trigger the batch job. Admin only -- a caretaker looks after one hostel and
 * should not start a college-wide allocation.
 *
 * Runs inline: the whole allocation is one SERIALIZABLE transaction that
 * finishes well within a request timeout at college scale (a few thousand
 * groups). If it ever outgrows that, this handler is the natural place to push
 * the job onto a Bull queue and return 202 + a run id -- allotment_runs already
 * gives the client something to poll.
 */
router.post(
  '/allocate',
  requireRole('admin'),
  validate(allocateSchema),
  asyncHandler(async (req, res) => {
    const summary = await runAllotment({
      semester: req.body.semester,
      triggeredBy: req.user.sub,
    });
    res.json({ summary });
  })
);

// ---------------------------------------------------------------------------
// Publishing results
// ---------------------------------------------------------------------------

const publishSchema = z.object({
  semester: z.string().min(1).max(32).trim().default(config.currentSemester),
});

router.get(
  '/results',
  asyncHandler(async (req, res) => {
    const semester = req.query.semester ?? config.currentSemester;
    res.json({ settings: await getSettings(semester) });
  })
);

/**
 * Release results to students. Until this is called, nothing student-facing
 * reveals a room or a waitlist place, so the batch can be run and re-run
 * without students watching the result change under them.
 */
router.post(
  '/results/publish',
  requireRole('admin'),
  validate(publishSchema),
  asyncHandler(async (req, res) => {
    const settings = await setPublished(req.body.semester, req.user.sub, true);
    res.json({ settings });
  })
);

/** Pull results back, e.g. to correct a mistake before students act on it. */
router.post(
  '/results/unpublish',
  requireRole('admin'),
  validate(publishSchema),
  asyncHandler(async (req, res) => {
    const settings = await setPublished(req.body.semester, req.user.sub, false);
    res.json({ settings });
  })
);

// ---------------------------------------------------------------------------
// Occupancy, waitlist, audit
// ---------------------------------------------------------------------------

router.get(
  '/occupancy',
  asyncHandler(async (req, res) => {
    const semester = req.query.semester ?? config.currentSemester;
    const hostelId = scopedHostelId(req.user);
    const rows = await getOccupancy(semester, hostelId);

    const totals = rows.reduce(
      (acc, row) => {
        acc.totalRooms += row.total_rooms;
        acc.allottedRooms += row.allotted_rooms;
        acc.maintenanceRooms += row.maintenance_rooms;
        return acc;
      },
      { totalRooms: 0, allottedRooms: 0, maintenanceRooms: 0 }
    );

    res.json({ semester, breakdown: rows, totals, scopedToHostel: hostelId });
  })
);

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

export default router;
