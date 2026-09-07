/**
 * What a student may and may not see.
 *
 * The rule: a student sees their own group and, once results are published,
 * their own room. They never see the roster, the CGPA ranking, other groups'
 * allotments, or any hint of their own outcome before publication.
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
const { setPublished } = await import('../src/services/results.service.js');
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

async function adminToken() {
  const { rows } = await pool.query(
    `INSERT INTO admins (email, name, role) VALUES ($1, 'Admin', 'admin') RETURNING id`,
    [`admin${Date.now()}${Math.random()}@test.edu`]
  );
  return signToken({ sub: rows[0].id, role: 'admin' });
}

/** One allotted group, plus an unrelated group the student must not see. */
async function allottedFixture() {
  const hostel = await makeHostel(pool, 'Hostel A', 'HA');
  const fourSeater = await makeRoomType(pool, '4-seater', 4);
  await makeRoom(pool, hostel, fourSeater, 'HA-101');
  await makeRoom(pool, hostel, fourSeater, 'HA-102');

  const mine = await makeGroup(pool, {
    name: 'Mine',
    semester: SEMESTER,
    cgpas: [9, 9, 9, 9],
    prefs: [[hostel, fourSeater]],
  });
  const theirs = await makeGroup(pool, {
    name: 'Theirs',
    semester: SEMESTER,
    cgpas: [8, 8, 8, 8],
    prefs: [[hostel, fourSeater]],
  });

  await runAllotment({ semester: SEMESTER });

  return {
    mine,
    theirs,
    studentToken: signToken({ sub: mine.memberIds[1], role: 'student' }),
    leadToken: signToken({ sub: mine.memberIds[0], role: 'student' }),
  };
}

test('the group roster and allotment list reject anonymous callers', { skip }, async () => {
  await allottedFixture();

  for (const path of ['/api/groups', '/api/allotments', '/api/students']) {
    const res = await request(path);
    assert.equal(res.status, 401, `${path} should require a token`);
  }
});

test('a student cannot read the roster or the full allotment list', { skip }, async () => {
  const { studentToken } = await allottedFixture();

  // These are the admin's view: who is ranked where, and who got which room.
  assert.equal((await request('/api/groups', { token: studentToken })).status, 403);
  assert.equal((await request('/api/allotments', { token: studentToken })).status, 403);
});

test('the student directory hides CGPA from students but not staff', { skip }, async () => {
  const { studentToken } = await allottedFixture();

  const asStudent = await request('/api/students?limit=5', { token: studentToken });
  assert.equal(asStudent.status, 200);
  assert.ok(
    asStudent.body.students.every((s) => s.cgpa === null),
    'a student sees names and emails, never CGPAs'
  );
  assert.ok(asStudent.body.students.every((s) => s.name), 'names still come back');

  const asAdmin = await request('/api/students?limit=5', { token: await adminToken() });
  assert.ok(
    asAdmin.body.students.some((s) => s.cgpa !== null),
    'staff still see CGPAs'
  );
});

test('a student cannot read another group', { skip }, async () => {
  const { theirs, studentToken } = await allottedFixture();

  assert.equal(
    (await request(`/api/groups/${theirs.id}`, { token: studentToken })).status,
    403
  );
  assert.equal(
    (await request(`/api/allotments/group/${theirs.id}`, { token: studentToken })).status,
    403
  );
});

test('no outcome leaks before results are published', { skip }, async () => {
  const { studentToken } = await allottedFixture();

  const result = await request('/api/allotments/mine', { token: studentToken });
  assert.equal(result.status, 200);
  assert.equal(result.body.resultsPublished, false);
  assert.equal(result.body.allotment, null, 'the room is withheld');
  assert.equal(result.body.group.status, undefined, 'the status is withheld too');
  assert.match(result.body.message, /not been published/);

  const group = await request('/api/groups/mine', { token: studentToken });
  assert.equal(
    group.body.group.status,
    'submitted',
    "'allotted' would tell them they got a room"
  );
  assert.equal(group.body.resultsPublished, false);
});

test('publishing reveals the result to the student', { skip }, async () => {
  const { studentToken } = await allottedFixture();
  await setPublished(SEMESTER, null, true);

  const result = await request('/api/allotments/mine', { token: studentToken });
  assert.equal(result.body.resultsPublished, true);
  assert.equal(result.body.allotment.room_number, 'HA-101');
  assert.equal(result.body.group.status, 'allotted');

  const group = await request('/api/groups/mine', { token: studentToken });
  assert.equal(group.body.group.status, 'allotted');

  // Publication does not open the admin's views.
  assert.equal((await request('/api/groups', { token: studentToken })).status, 403);
});

test('unpublishing hides the result again', { skip }, async () => {
  const { studentToken } = await allottedFixture();
  await setPublished(SEMESTER, null, true);
  await setPublished(SEMESTER, null, false);

  const result = await request('/api/allotments/mine', { token: studentToken });
  assert.equal(result.body.resultsPublished, false);
  assert.equal(result.body.allotment, null);
});

test('a frozen group does not reveal why it is frozen', { skip }, async () => {
  const { mine, leadToken } = await allottedFixture();

  // The group is allotted, so membership is closed -- but saying "already
  // allotted" would leak the outcome before publication.
  const before = await request(`/api/groups/${mine.id}/members/${mine.memberIds[1]}`, {
    method: 'DELETE',
    token: leadToken,
  });
  assert.equal(before.status, 409);
  assert.doesNotMatch(before.body.error, /allotted/, 'message must stay neutral');
  assert.match(before.body.error, /being processed/);

  await setPublished(SEMESTER, null, true);

  const after = await request(`/api/groups/${mine.id}/members/${mine.memberIds[1]}`, {
    method: 'DELETE',
    token: leadToken,
  });
  assert.match(after.body.error, /already allotted/, 'once published it can say so');
});

test('only an admin can publish results', { skip }, async () => {
  const { studentToken } = await allottedFixture();
  const { rows } = await pool.query(
    `INSERT INTO admins (email, name, role) VALUES ('ct@test.edu', 'CT', 'caretaker') RETURNING id`
  );
  const caretaker = signToken({ sub: rows[0].id, role: 'caretaker' });

  assert.equal(
    (await request('/api/admin/results/publish', {
      method: 'POST',
      token: studentToken,
      body: { semester: SEMESTER },
    })).status,
    403
  );
  assert.equal(
    (await request('/api/admin/results/publish', {
      method: 'POST',
      token: caretaker,
      body: { semester: SEMESTER },
    })).status,
    403
  );
  assert.equal(
    (await request('/api/admin/results/publish', {
      method: 'POST',
      token: await adminToken(),
      body: { semester: SEMESTER },
    })).status,
    200
  );
});
