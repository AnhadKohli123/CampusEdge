/**
 * Behaviour tests for the batch allotment job.
 *
 * These run against a real PostgreSQL database because the interesting parts
 * (SERIALIZABLE, the unique constraints, row locking) do not exist in a mock.
 * Point TEST_DATABASE_URL at a scratch database -- the suite TRUNCATEs every
 * table before each test, so never aim it at anything you care about.
 */
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL is not set';

// config.js reads DATABASE_URL at import time, so it has to be set before the
// dynamic imports below.
process.env.DATABASE_URL = TEST_DB ?? 'postgres://unused';
process.env.JWT_SECRET ??= 'test-secret';

const { pool, closePool } = await import('../src/db.js');
const { runAllotment } = await import('../src/services/allotment.service.js');
const {
  applySchema,
  resetDb,
  makeHostel,
  makeRoomType,
  makeRoom,
  makeGroup,
  allotmentFor,
  groupStatus,
} = await import('./helpers.js');

const SEMESTER = '2024-Spring';

before(async () => {
  if (skip) return;
  await applySchema(pool);
});

beforeEach(async () => {
  if (skip) return;
  await resetDb(pool);
});

after(async () => {
  await closePool();
});

/** Two hostels, one 4-bed room type, one room in hostel A. */
async function tinyInventory() {
  const hostelA = await makeHostel(pool, 'Hostel A', 'HA');
  const hostelB = await makeHostel(pool, 'Hostel B', 'HB');
  const fourSeater = await makeRoomType(pool, '4-seater', 4);
  return { hostelA, hostelB, fourSeater };
}

test('ranks groups by average CGPA, not submission order', { skip }, async () => {
  const { hostelA, fourSeater } = await tinyInventory();
  await makeRoom(pool, hostelA, fourSeater, 'HA-101');

  // Created first, but lower average -- it should lose the only room.
  const weaker = await makeGroup(pool, {
    name: 'Weaker',
    semester: SEMESTER,
    cgpas: [6.0, 6.0, 6.0, 6.0],
    prefs: [[hostelA, fourSeater]],
  });
  const stronger = await makeGroup(pool, {
    name: 'Stronger',
    semester: SEMESTER,
    cgpas: [9.0, 9.0, 9.0, 9.0],
    prefs: [[hostelA, fourSeater]],
  });

  const summary = await runAllotment({ semester: SEMESTER });

  assert.equal(summary.allotted, 1);
  assert.equal(summary.waitlisted, 1);
  assert.ok(await allotmentFor(pool, stronger.id, SEMESTER), 'stronger group got the room');
  assert.equal(await allotmentFor(pool, weaker.id, SEMESTER), null);
  assert.equal(await groupStatus(pool, weaker.id), 'waitlist');
});

test('falls through to the next preference when the first is full', { skip }, async () => {
  const { hostelA, hostelB, fourSeater } = await tinyInventory();
  await makeRoom(pool, hostelA, fourSeater, 'HA-101');
  await makeRoom(pool, hostelB, fourSeater, 'HB-101');

  const first = await makeGroup(pool, {
    name: 'First',
    semester: SEMESTER,
    cgpas: [9.5, 9.5, 9.5, 9.5],
    prefs: [[hostelA, fourSeater], [hostelB, fourSeater]],
  });
  const second = await makeGroup(pool, {
    name: 'Second',
    semester: SEMESTER,
    cgpas: [8.0, 8.0, 8.0, 8.0],
    prefs: [[hostelA, fourSeater], [hostelB, fourSeater]],
  });

  const summary = await runAllotment({ semester: SEMESTER });

  assert.equal(summary.allotted, 2);
  const firstAllotment = await allotmentFor(pool, first.id, SEMESTER);
  const secondAllotment = await allotmentFor(pool, second.id, SEMESTER);

  assert.equal(firstAllotment.hostel_name, 'Hostel A');
  assert.equal(firstAllotment.matched_rank, 1);
  // Hostel A is gone, so the second group takes its rank-2 choice.
  assert.equal(secondAllotment.hostel_name, 'Hostel B');
  assert.equal(secondAllotment.matched_rank, 2);
  assert.deepEqual(summary.byPreferenceRank, { 1: 1, 2: 1 });
});

test('incomplete groups get no allocation', { skip }, async () => {
  const { hostelA, fourSeater } = await tinyInventory();
  await makeRoom(pool, hostelA, fourSeater, 'HA-101');

  // Three members, top CGPAs -- still ineligible.
  const trio = await makeGroup(pool, {
    name: 'Trio',
    semester: SEMESTER,
    cgpas: [10.0, 10.0, 10.0],
    prefs: [[hostelA, fourSeater]],
  });
  const quad = await makeGroup(pool, {
    name: 'Quad',
    semester: SEMESTER,
    cgpas: [7.0, 7.0, 7.0, 7.0],
    prefs: [[hostelA, fourSeater]],
  });

  const summary = await runAllotment({ semester: SEMESTER });

  assert.equal(summary.skippedIncomplete, 1);
  assert.equal(await allotmentFor(pool, trio.id, SEMESTER), null);
  assert.equal(await groupStatus(pool, trio.id), 'waitlist');
  // The complete group still gets the room the trio could not claim.
  assert.ok(await allotmentFor(pool, quad.id, SEMESTER));
});

test('skips rooms flagged for maintenance', { skip }, async () => {
  const { hostelA, fourSeater } = await tinyInventory();
  await makeRoom(pool, hostelA, fourSeater, 'HA-101', 'maintenance');
  await makeRoom(pool, hostelA, fourSeater, 'HA-102', 'reserved');

  const group = await makeGroup(pool, {
    name: 'Solo',
    semester: SEMESTER,
    cgpas: [9, 9, 9, 9],
    prefs: [[hostelA, fourSeater]],
  });

  const summary = await runAllotment({ semester: SEMESTER });

  assert.equal(summary.allotted, 0);
  assert.equal(summary.waitlisted, 1);
  assert.equal(await allotmentFor(pool, group.id, SEMESTER), null);
});

test('never places a group in a room sized for a different group', { skip }, async () => {
  const hostelA = await makeHostel(pool, 'Hostel A', 'HA');
  const twoSeater = await makeRoomType(pool, '2-seater AC', 2);
  const sixSeater = await makeRoomType(pool, '6-seater', 6);
  await makeRoom(pool, hostelA, twoSeater, 'HA-101');
  await makeRoom(pool, hostelA, sixSeater, 'HA-201');

  const group = await makeGroup(pool, {
    name: 'Quad',
    semester: SEMESTER,
    cgpas: [9, 9, 9, 9],
    prefs: [[hostelA, twoSeater], [hostelA, sixSeater]],
  });

  const summary = await runAllotment({ semester: SEMESTER });

  assert.equal(summary.allotted, 0, 'a 4-group fits neither a 2-bed nor a 6-bed room');
  assert.equal(await groupStatus(pool, group.id), 'waitlist');
});

test('re-running is idempotent and does not move allotted groups', { skip }, async () => {
  const { hostelA, hostelB, fourSeater } = await tinyInventory();
  await makeRoom(pool, hostelA, fourSeater, 'HA-101');
  await makeRoom(pool, hostelB, fourSeater, 'HB-101');

  const group = await makeGroup(pool, {
    name: 'Stable',
    semester: SEMESTER,
    cgpas: [9, 9, 9, 9],
    prefs: [[hostelA, fourSeater]],
  });

  const first = await runAllotment({ semester: SEMESTER });
  const firstRoom = await allotmentFor(pool, group.id, SEMESTER);

  const second = await runAllotment({ semester: SEMESTER });
  const secondRoom = await allotmentFor(pool, group.id, SEMESTER);

  assert.equal(first.allotted, 1);
  // Second pass has nothing left to do: the group is no longer 'active'.
  assert.equal(second.allotted, 0);
  assert.equal(second.consideredGroups, 0);
  assert.deepEqual(secondRoom, firstRoom, 'the group kept the same room');

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM allotments');
  assert.equal(rows[0].n, 1, 'no duplicate allotment row');
});

test('a late group is placed by a re-run without disturbing the rest', { skip }, async () => {
  const { hostelA, hostelB, fourSeater } = await tinyInventory();
  await makeRoom(pool, hostelA, fourSeater, 'HA-101');
  await makeRoom(pool, hostelB, fourSeater, 'HB-101');

  const early = await makeGroup(pool, {
    name: 'Early',
    semester: SEMESTER,
    cgpas: [7, 7, 7, 7],
    prefs: [[hostelA, fourSeater], [hostelB, fourSeater]],
  });
  await runAllotment({ semester: SEMESTER });
  const earlyRoom = await allotmentFor(pool, early.id, SEMESTER);

  // A stronger group registers after the first batch has already run.
  const late = await makeGroup(pool, {
    name: 'Late',
    semester: SEMESTER,
    cgpas: [9.9, 9.9, 9.9, 9.9],
    prefs: [[hostelA, fourSeater], [hostelB, fourSeater]],
  });
  await runAllotment({ semester: SEMESTER });

  // Higher CGPA does not evict an existing allotment -- it takes what is left.
  assert.deepEqual(await allotmentFor(pool, early.id, SEMESTER), earlyRoom);
  const lateRoom = await allotmentFor(pool, late.id, SEMESTER);
  assert.equal(lateRoom.hostel_name, 'Hostel B');
  assert.equal(lateRoom.matched_rank, 2);
});

test('groups with no preferences are waitlisted with a reason', { skip }, async () => {
  const { hostelA, fourSeater } = await tinyInventory();
  await makeRoom(pool, hostelA, fourSeater, 'HA-101');

  const group = await makeGroup(pool, {
    name: 'Undecided',
    semester: SEMESTER,
    cgpas: [9, 9, 9, 9],
    prefs: [],
  });

  const summary = await runAllotment({ semester: SEMESTER });

  assert.equal(summary.waitlisted, 1);
  const entry = summary.unplaced.find((u) => u.groupId === group.id);
  assert.equal(entry.reason, 'no_preferences_submitted');
});

test('semesters are isolated from each other', { skip }, async () => {
  const { hostelA, fourSeater } = await tinyInventory();
  await makeRoom(pool, hostelA, fourSeater, 'HA-101');

  const spring = await makeGroup(pool, {
    name: 'Spring group',
    semester: '2024-Spring',
    cgpas: [8, 8, 8, 8],
    prefs: [[hostelA, fourSeater]],
  });
  const autumn = await makeGroup(pool, {
    name: 'Autumn group',
    semester: '2024-Autumn',
    cgpas: [8, 8, 8, 8],
    prefs: [[hostelA, fourSeater]],
  });

  await runAllotment({ semester: '2024-Spring' });
  await runAllotment({ semester: '2024-Autumn' });

  // The same physical room is allotted once per semester, to a different group.
  const springRoom = await allotmentFor(pool, spring.id, '2024-Spring');
  const autumnRoom = await allotmentFor(pool, autumn.id, '2024-Autumn');
  assert.equal(springRoom.room_number, 'HA-101');
  assert.equal(autumnRoom.room_number, 'HA-101');
});

test('records every run in the audit table', { skip }, async () => {
  const { hostelA, fourSeater } = await tinyInventory();
  await makeRoom(pool, hostelA, fourSeater, 'HA-101');
  await makeGroup(pool, {
    name: 'Audited',
    semester: SEMESTER,
    cgpas: [8, 8, 8, 8],
    prefs: [[hostelA, fourSeater]],
  });

  await runAllotment({ semester: SEMESTER });

  const { rows } = await pool.query(
    `SELECT status, semester, summary FROM allotment_runs ORDER BY started_at DESC`
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'succeeded');
  assert.equal(rows[0].semester, SEMESTER);
  assert.equal(rows[0].summary.allotted, 1);
});
