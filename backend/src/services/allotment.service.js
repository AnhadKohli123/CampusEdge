import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';

/**
 * Batch allotment.
 *
 * Ordering rule: groups are ranked by average CGPA (highest first). Ties break
 * on created_at (first-come-first-served), then id, so a re-run on unchanged
 * data always produces the same result.
 *
 * Matching rule: a group is only placed in a room whose room_type capacity
 * equals the group size. Rooms are handed to one group whole -- the brief's
 * "empty rooms stay empty (no forced pairing)" -- so putting a 4-person group
 * in a 6-bed room would strand two beds, and a 2-bed room cannot hold them at
 * all. Rooms whose capacity has no matching group size simply go unallotted.
 *
 * Idempotency: only groups that do not already hold a room are considered
 * (status 'active' or 'waitlist'), and only rooms with no allotment row for the
 * semester are offered. A group that already holds a room keeps it. Re-running
 * is therefore safe and incremental -- it places newly-added and previously
 * waitlisted groups without disturbing existing placements.
 *
 * Concurrency: everything runs in one SERIALIZABLE transaction, guarded by a
 * transaction-scoped advisory lock keyed on the semester, so two admins hitting
 * "Run allotment" at once queue up instead of racing. UNIQUE(room_id, semester)
 * is the last line of defence.
 */

const ADVISORY_LOCK_NAMESPACE = 'campusedge:allotment';

/** Groups eligible to be ranked: exactly `groupSize` members and still active. */
const ELIGIBLE_GROUPS_SQL = `
  WITH sized AS (
    SELECT g.id,
           g.name,
           g.semester,
           g.created_at,
           COUNT(gm.id)::int         AS member_count,
           ROUND(AVG(s.cgpa), 2)     AS avg_cgpa
      FROM groups g
      LEFT JOIN group_members gm ON gm.group_id = g.id
      LEFT JOIN students s       ON s.id = gm.student_id
     WHERE g.semester = $1
       -- Waitlisted groups are reconsidered on every run: if a room comes back
       -- from maintenance or a group disbands, they should get it. Only
       -- already-allotted groups are skipped, which is what keeps re-runs from
       -- moving anyone.
       AND g.status IN ('active', 'waitlist')
     GROUP BY g.id
  )
  SELECT * FROM sized
   ORDER BY (member_count = $2) DESC,   -- complete groups first
            avg_cgpa DESC NULLS LAST,
            created_at ASC,
            id ASC
`;

const FIND_FREE_ROOM_SQL = `
  SELECT r.id, r.room_number, rt.capacity, h.name AS hostel_name, rt.name AS room_type_name
    FROM rooms r
    JOIN room_types rt ON rt.id = r.room_type_id
    JOIN hostels h     ON h.id = r.hostel_id
   WHERE r.hostel_id = $1
     AND r.room_type_id = $2
     AND r.status = 'active'
     AND rt.capacity = $3
     AND NOT EXISTS (
           SELECT 1 FROM allotments a
            WHERE a.room_id = r.id AND a.semester = $4
         )
   ORDER BY r.room_number ASC
   LIMIT 1
   FOR UPDATE OF r
`;

async function allocateInTransaction(client, semester) {
  // Serialise concurrent runs for this semester.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `${ADVISORY_LOCK_NAMESPACE}:${semester}`,
  ]);

  const { groupSize } = config;

  const { rows: groups } = await client.query(ELIGIBLE_GROUPS_SQL, [
    semester,
    groupSize,
  ]);

  const summary = {
    semester,
    groupSize,
    consideredGroups: groups.length,
    allotted: 0,
    waitlisted: 0,
    skippedIncomplete: 0,
    byPreferenceRank: {},
    placements: [],
    unplaced: [],
  };

  for (const group of groups) {
    // Incomplete groups get no allocation, per the brief.
    if (group.member_count !== groupSize) {
      await client.query(
        `UPDATE groups SET status = 'waitlist', avg_cgpa = $2 WHERE id = $1`,
        [group.id, group.avg_cgpa]
      );
      summary.skippedIncomplete += 1;
      summary.unplaced.push({
        groupId: group.id,
        name: group.name,
        reason: `incomplete_group (${group.member_count}/${groupSize} members)`,
      });
      continue;
    }

    // Keep the stored average in step with current student CGPAs.
    await client.query(`UPDATE groups SET avg_cgpa = $2 WHERE id = $1`, [
      group.id,
      group.avg_cgpa,
    ]);

    const { rows: preferences } = await client.query(
      `SELECT rank, hostel_id, room_type_id
         FROM preferences
        WHERE group_id = $1
        ORDER BY rank ASC`,
      [group.id]
    );

    let placed = null;
    for (const pref of preferences) {
      const { rows: rooms } = await client.query(FIND_FREE_ROOM_SQL, [
        pref.hostel_id,
        pref.room_type_id,
        groupSize,
        semester,
      ]);
      if (rooms.length === 0) continue;

      const room = rooms[0];
      await client.query(
        `INSERT INTO allotments (group_id, room_id, semester, matched_rank)
         VALUES ($1, $2, $3, $4)`,
        [group.id, room.id, semester, pref.rank]
      );
      await client.query(
        `UPDATE rooms SET current_occupancy = $2 WHERE id = $1`,
        [room.id, groupSize]
      );
      await client.query(`UPDATE groups SET status = 'allotted' WHERE id = $1`, [
        group.id,
      ]);

      placed = { room, rank: pref.rank };
      break;
    }

    if (placed) {
      summary.allotted += 1;
      summary.byPreferenceRank[placed.rank] =
        (summary.byPreferenceRank[placed.rank] ?? 0) + 1;
      summary.placements.push({
        groupId: group.id,
        name: group.name,
        avgCgpa: group.avg_cgpa,
        matchedRank: placed.rank,
        hostel: placed.room.hostel_name,
        roomType: placed.room.room_type_name,
        roomNumber: placed.room.room_number,
      });
    } else {
      await client.query(
        `UPDATE groups SET status = 'waitlist' WHERE id = $1`,
        [group.id]
      );
      summary.waitlisted += 1;
      summary.unplaced.push({
        groupId: group.id,
        name: group.name,
        reason:
          preferences.length === 0
            ? 'no_preferences_submitted'
            : 'no_room_available_for_any_preference',
      });
    }
  }

  const { rows: capacityRows } = await client.query(
    `SELECT COUNT(*)::int AS free_rooms
       FROM rooms r
       JOIN room_types rt ON rt.id = r.room_type_id
      WHERE r.status = 'active'
        AND rt.capacity = $2
        AND NOT EXISTS (
              SELECT 1 FROM allotments a
               WHERE a.room_id = r.id AND a.semester = $1
            )`,
    [semester, groupSize]
  );
  summary.roomsStillFree = capacityRows[0].free_rooms;

  return summary;
}

/**
 * Public entry point. Records the run in allotment_runs (an audit row that
 * survives failures) and retries on serialization conflicts.
 */
export async function runAllotment({ semester, triggeredBy = null, maxAttempts = 3 }) {
  const { rows: runRows } = await pool.query(
    `INSERT INTO allotment_runs (semester, triggered_by) VALUES ($1, $2) RETURNING id, started_at`,
    [semester, triggeredBy]
  );
  const run = runRows[0];

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const summary = await withTransaction(
        (client) => allocateInTransaction(client, semester),
        { isolation: 'SERIALIZABLE' }
      );

      await pool.query(
        `UPDATE allotment_runs
            SET status = 'succeeded', finished_at = now(), summary = $2
          WHERE id = $1`,
        [run.id, JSON.stringify({ ...summary, attempts: attempt })]
      );
      return { runId: run.id, startedAt: run.started_at, ...summary };
    } catch (err) {
      lastError = err;
      // 40001 = serialization_failure, 40P01 = deadlock_detected. Both are
      // "try again" conditions rather than real errors.
      if (err.code !== '40001' && err.code !== '40P01') break;
    }
  }

  await pool.query(
    `UPDATE allotment_runs
        SET status = 'failed', finished_at = now(), error = $2
      WHERE id = $1`,
    [run.id, lastError?.message ?? 'unknown error']
  );
  throw lastError;
}

/**
 * Occupancy rollup used by the admin screen. `hostelId` scopes the result to a
 * single hostel, which is what a caretaker sees.
 */
export async function getOccupancy(semester, hostelId = null) {
  const { rows } = await pool.query(
    `SELECT h.name                         AS hostel,
            rt.name                        AS room_type,
            rt.capacity                    AS capacity,
            COUNT(*)::int                  AS total_rooms,
            COUNT(a.id)::int               AS allotted_rooms,
            COUNT(*) FILTER (WHERE r.status = 'maintenance')::int AS maintenance_rooms
       FROM rooms r
       JOIN hostels h     ON h.id = r.hostel_id
       JOIN room_types rt ON rt.id = r.room_type_id
       LEFT JOIN allotments a ON a.room_id = r.id AND a.semester = $1
      WHERE ($2::uuid IS NULL OR r.hostel_id = $2)
      GROUP BY h.name, rt.name, rt.capacity
      ORDER BY h.name, rt.name`,
    [semester, hostelId]
  );
  return rows;
}
