/**
 * API-level tests for the rules that protect an allotted group. These run the
 * real Express app against the real database -- the constraints being tested
 * live in both the route and the schema.
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
const { applySchema, resetDb, makeHostel, makeRoomType, makeRoom, makeGroup } =
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

function request(path, { method = 'GET', token, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function allottedGroupFixture() {
  const hostel = await makeHostel(pool, 'Hostel A', 'HA');
  const fourSeater = await makeRoomType(pool, '4-seater', 4);
  await makeRoom(pool, hostel, fourSeater, 'HA-101');

  const group = await makeGroup(pool, {
    name: 'Locked',
    semester: SEMESTER,
    cgpas: [9, 9, 9, 9],
    prefs: [[hostel, fourSeater]],
  });
  await runAllotment({ semester: SEMESTER });

  const leadToken = signToken({ sub: group.memberIds[0], role: 'student' });
  return { group, leadToken };
}

test('an allotted group cannot drop a member', { skip }, async () => {
  const { group, leadToken } = await allottedGroupFixture();

  const response = await request(
    `/api/groups/${group.id}/members/${group.memberIds[1]}`,
    { method: 'DELETE', token: leadToken }
  );

  assert.equal(response.status, 409);
  // The message stays neutral because results are not published in this
  // fixture -- see privacy.test.js for why. The group is frozen either way.
  assert.match((await response.json()).error, /closed while allotment is being processed/);

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM group_members WHERE group_id = $1',
    [group.id]
  );
  assert.equal(rows[0].n, 4, 'the room still has four occupants');
});

test('an allotted group cannot change its preferences', { skip }, async () => {
  const { group, leadToken } = await allottedGroupFixture();
  const { rows } = await pool.query('SELECT id FROM hostels LIMIT 1');
  const { rows: types } = await pool.query('SELECT id FROM room_types LIMIT 1');

  const response = await request(`/api/groups/${group.id}/preferences`, {
    method: 'PUT',
    token: leadToken,
    body: { preferences: [{ hostelId: rows[0].id, roomTypeId: types[0].id }] },
  });

  assert.equal(response.status, 409);
});

test('a non-lead member cannot add someone to the group', { skip }, async () => {
  const hostel = await makeHostel(pool, 'Hostel A', 'HA');
  const fourSeater = await makeRoomType(pool, '4-seater', 4);
  const group = await makeGroup(pool, {
    name: 'Trio',
    semester: SEMESTER,
    cgpas: [9, 9, 9],
  });
  const outsider = await makeGroup(pool, {
    name: 'Other',
    semester: '2024-Autumn',
    cgpas: [7],
  });

  // memberIds[1] is a member but not the lead.
  const response = await request(`/api/groups/${group.id}/members`, {
    method: 'POST',
    token: signToken({ sub: group.memberIds[1], role: 'student' }),
    body: { studentId: outsider.memberIds[0] },
  });

  assert.equal(response.status, 403);
  assert.equal(fourSeater.capacity, 4);
});

test('a student cannot join two groups in the same semester', { skip }, async () => {
  const first = await makeGroup(pool, {
    name: 'First',
    semester: SEMESTER,
    cgpas: [8, 8],
  });
  const second = await makeGroup(pool, {
    name: 'Second',
    semester: SEMESTER,
    cgpas: [8],
  });

  const response = await request(`/api/groups/${second.id}/members`, {
    method: 'POST',
    token: signToken({ sub: second.memberIds[0], role: 'student' }),
    body: { studentId: first.memberIds[1] },
  });

  assert.equal(response.status, 409, 'the cross-group unique index rejects it');
});

test('the allotment endpoint rejects a student token', { skip }, async () => {
  const group = await makeGroup(pool, { name: 'G', semester: SEMESTER, cgpas: [8] });

  const response = await request('/api/admin/allocate', {
    method: 'POST',
    token: signToken({ sub: group.memberIds[0], role: 'student' }),
    body: { semester: SEMESTER },
  });

  assert.equal(response.status, 403);
});
