/**
 * Hostel buildings are single-gender, so a group must be single-gender too and
 * can only be placed in a matching building. Enforced in three places: adding a
 * member, storing preferences, and the batch job itself.
 */
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL is not set';

process.env.DATABASE_URL = TEST_DB ?? 'postgres://unused';
process.env.JWT_SECRET ??= 'test-secret';

const { pool, closePool } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { signToken } = await import('../src/middleware/auth.js');
const { runAllotment } = await import('../src/services/allotment.service.js');
const { applySchema, resetDb, makeHostel, makeRoomType, makeRoom, makeGroup, allotmentFor } =
  await import('./helpers.js');

const SEMESTER = '2024-Spring';
let server;
let baseUrl;

before(async () => {
  if (skip) return;
  await applySchema(pool);
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  if (skip) return;
  await resetDb(pool);
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closePool();
});

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function makeStudent(email, gender, cgpa = 8) {
  const { rows } = await pool.query(
    `INSERT INTO students (email, name, cgpa, gender) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, email.split('@')[0], cgpa, gender]
  );
  return rows[0].id;
}

/** Two boys' blocks and one girls' block, each with a 4-bed room. */
async function campus() {
  const boysA = await makeHostel(pool, 'Hostel A', 'HA', 'male');
  const boysB = await makeHostel(pool, 'Hostel B', 'HB', 'male');
  const girlsC = await makeHostel(pool, 'Hostel C', 'HC', 'female');
  const fourSeater = await makeRoomType(pool, '4-seater', 4);
  await makeRoom(pool, boysA, fourSeater, 'HA-101');
  await makeRoom(pool, boysB, fourSeater, 'HB-101');
  await makeRoom(pool, girlsC, fourSeater, 'HC-101');
  return { boysA, boysB, girlsC, fourSeater };
}

test('signup requires a gender', { skip }, async () => {
  const without = await request('/api/auth/student/signup', {
    method: 'POST',
    body: {
      email: 'nogender@test.edu',
      name: 'No Gender',
      password: 'password123',
      cgpa: 8,
    },
  });
  assert.equal(without.status, 400);
  assert.ok(
    without.body.details.some((d) => d.field === 'gender'),
    'the missing field is named'
  );

  const withGender = await request('/api/auth/student/signup', {
    method: 'POST',
    body: {
      email: 'ok@test.edu',
      name: 'Fine',
      password: 'password123',
      cgpa: 8,
      gender: 'female',
    },
  });
  assert.equal(withGender.status, 201);
  assert.equal(withGender.body.student.gender, 'female');
});

test('a lead cannot add a member of another gender', { skip }, async () => {
  await campus();
  const group = await makeGroup(pool, {
    name: "Boys' group",
    semester: SEMESTER,
    cgpas: [8, 8],
    gender: 'male',
  });
  const girl = await makeStudent('kavya@test.edu', 'female');

  const res = await request(`/api/groups/${group.id}/members`, {
    method: 'POST',
    token: signToken({ sub: group.memberIds[0], role: 'student' }),
    body: { studentId: girl },
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /cannot be mixed/);

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM group_members WHERE group_id = $1',
    [group.id]
  );
  assert.equal(rows[0].n, 2, 'nothing was added');
});

test('a group cannot rank a hostel of the other gender', { skip }, async () => {
  const { boysA, girlsC, fourSeater } = await campus();
  const group = await makeGroup(pool, {
    name: "Girls' group",
    semester: SEMESTER,
    cgpas: [9, 9, 9, 9],
    gender: 'female',
  });
  const leadToken = signToken({ sub: group.memberIds[0], role: 'student' });

  const rejected = await request(`/api/groups/${group.id}/preferences`, {
    method: 'PUT',
    token: leadToken,
    body: { preferences: [{ hostelId: boysA.id, roomTypeId: fourSeater.id }] },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /girls' hostels/);

  const accepted = await request(`/api/groups/${group.id}/preferences`, {
    method: 'PUT',
    token: leadToken,
    body: { preferences: [{ hostelId: girlsC.id, roomTypeId: fourSeater.id }] },
  });
  assert.equal(accepted.status, 200);
});

test('the hostel list can be filtered to a gender', { skip }, async () => {
  await campus();
  const all = await request('/api/catalog/hostels');
  assert.equal(all.body.hostels.length, 3);

  const girls = await request('/api/catalog/hostels?gender=female');
  assert.deepEqual(
    girls.body.hostels.map((h) => h.name),
    ['Hostel C']
  );
});

test('the batch never places a group in the other gender’s building', { skip }, async () => {
  const { boysA, girlsC, fourSeater } = await campus();

  // A girls' group whose preference points at a boys' hostel. The API would
  // refuse to store this, so it is written directly -- the case being tested is
  // a hostel re-designated after preferences were taken.
  const girls = await makeGroup(pool, {
    name: 'Girls',
    semester: SEMESTER,
    cgpas: [10, 10, 10, 10],
    gender: 'female',
  });
  await pool.query(
    `INSERT INTO preferences (group_id, rank, hostel_id, room_type_id) VALUES ($1, 1, $2, $3)`,
    [girls.id, boysA.id, fourSeater.id]
  );
  // Second choice is a legitimate girls' block.
  await pool.query(
    `INSERT INTO preferences (group_id, rank, hostel_id, room_type_id) VALUES ($1, 2, $2, $3)`,
    [girls.id, girlsC.id, fourSeater.id]
  );

  const summary = await runAllotment({ semester: SEMESTER });

  assert.equal(summary.allotted, 1);
  const placed = await allotmentFor(pool, girls.id, SEMESTER);
  assert.equal(placed.hostel_name, 'Hostel C', 'skipped the boys’ block entirely');
  assert.equal(placed.matched_rank, 2);
});

test('boys and girls compete only against their own room supply', { skip }, async () => {
  const { boysA, girlsC, fourSeater } = await campus();

  // One 4-bed room in each block, two groups per gender: the stronger of each
  // pair takes their own block's room, the weaker waits.
  const strongBoys = await makeGroup(pool, {
    name: 'Strong boys', semester: SEMESTER, cgpas: [9, 9, 9, 9], gender: 'male',
    prefs: [[boysA, fourSeater]],
  });
  const weakBoys = await makeGroup(pool, {
    name: 'Weak boys', semester: SEMESTER, cgpas: [6, 6, 6, 6], gender: 'male',
    prefs: [[boysA, fourSeater]],
  });
  // Deliberately the lowest CGPA on campus -- still gets a room, because it is
  // only competing with other girls' groups.
  const lowestGirls = await makeGroup(pool, {
    name: 'Lowest girls', semester: SEMESTER, cgpas: [5, 5, 5, 5], gender: 'female',
    prefs: [[girlsC, fourSeater]],
  });

  const summary = await runAllotment({ semester: SEMESTER });

  assert.equal(summary.allotted, 2);
  assert.ok(await allotmentFor(pool, strongBoys.id, SEMESTER));
  assert.equal(await allotmentFor(pool, weakBoys.id, SEMESTER), null);
  assert.ok(
    await allotmentFor(pool, lowestGirls.id, SEMESTER),
    'a low-CGPA girls’ group is not beaten by a high-CGPA boys’ group'
  );

  // Free rooms are reported per gender and capacity, since a spare boys' room
  // is no use to a waitlisted girls' group.
  assert.deepEqual(summary.freeRooms, [{ gender: 'male', capacity: 4, rooms: 1 }]);
});

test('a group with no gender is waitlisted with a reason', { skip }, async () => {
  const { boysA, fourSeater } = await campus();
  const group = await makeGroup(pool, {
    name: 'Unset', semester: SEMESTER, cgpas: [9, 9, 9, 9], gender: 'male',
    prefs: [[boysA, fourSeater]],
  });
  await pool.query('UPDATE groups SET gender = NULL WHERE id = $1', [group.id]);

  const summary = await runAllotment({ semester: SEMESTER });

  assert.equal(summary.allotted, 0);
  assert.equal(
    summary.unplaced.find((u) => u.groupId === group.id).reason,
    'group_gender_not_set'
  );
});
