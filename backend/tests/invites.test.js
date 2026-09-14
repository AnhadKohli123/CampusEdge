/**
 * Invite links and the admin/caretaker role split.
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
const { applySchema, resetDb, makeHostel, makeRoomType, makeGroup } = await import(
  './helpers.js'
);

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

async function makeStudent(email, cgpa = 8.0, gender = 'male') {
  const { rows } = await pool.query(
    `INSERT INTO students (email, name, cgpa, gender) VALUES ($1, $2, $3, $4)
     RETURNING id, email`,
    [email, email.split('@')[0], cgpa, gender]
  );
  return { ...rows[0], token: signToken({ sub: rows[0].id, role: 'student' }) };
}

/** A two-person group with its lead's token. */
async function pairFixture() {
  const group = await makeGroup(pool, {
    name: 'Team Falcon',
    semester: SEMESTER,
    cgpas: [9.0, 8.5],
  });
  return { group, leadToken: signToken({ sub: group.memberIds[0], role: 'student' }) };
}

test('a lead can create an invite link and a student can accept it', { skip }, async () => {
  const { group, leadToken } = await pairFixture();

  const created = await request(`/api/groups/${group.id}/invites`, {
    method: 'POST',
    token: leadToken,
    body: {},
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.invite.state, 'pending');
  assert.match(created.body.invite.url, /\/join\//);

  const token = created.body.invite.token;

  // The join page can describe the invite without being signed in.
  const preview = await request(`/api/invites/${token}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.invite.groupName, 'Team Falcon');
  assert.equal(preview.body.invite.memberCount, 2);

  const joiner = await makeStudent('joiner@test.edu');
  const accepted = await request(`/api/invites/${token}/accept`, {
    method: 'POST',
    token: joiner.token,
  });
  assert.equal(accepted.status, 200);

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM group_members WHERE group_id = $1',
    [group.id]
  );
  assert.equal(rows[0].n, 3);
});

test('an invite can only be used once', { skip }, async () => {
  const { group, leadToken } = await pairFixture();
  const created = await request(`/api/groups/${group.id}/invites`, {
    method: 'POST',
    token: leadToken,
    body: {},
  });
  const token = created.body.invite.token;

  const first = await makeStudent('first@test.edu');
  const second = await makeStudent('second@test.edu');

  assert.equal(
    (await request(`/api/invites/${token}/accept`, { method: 'POST', token: first.token }))
      .status,
    200
  );
  const reuse = await request(`/api/invites/${token}/accept`, {
    method: 'POST',
    token: second.token,
  });
  assert.equal(reuse.status, 409);
  assert.match(reuse.body.error, /already been used/);
});

test('an email-bound invite rejects a different student', { skip }, async () => {
  const { group, leadToken } = await pairFixture();
  const created = await request(`/api/groups/${group.id}/invites`, {
    method: 'POST',
    token: leadToken,
    body: { email: 'invited@test.edu' },
  });
  const token = created.body.invite.token;

  const wrongPerson = await makeStudent('someone.else@test.edu');
  const rejected = await request(`/api/invites/${token}/accept`, {
    method: 'POST',
    token: wrongPerson.token,
  });
  assert.equal(rejected.status, 403);
  assert.match(rejected.body.error, /invited@test\.edu/);

  const rightPerson = await makeStudent('invited@test.edu');
  const ok = await request(`/api/invites/${token}/accept`, {
    method: 'POST',
    token: rightPerson.token,
  });
  assert.equal(ok.status, 200);
});

test('pending invites count against the group size', { skip }, async () => {
  const { group, leadToken } = await pairFixture(); // 2 of 4 seats used

  for (const email of ['a@test.edu', 'b@test.edu']) {
    const res = await request(`/api/groups/${group.id}/invites`, {
      method: 'POST',
      token: leadToken,
      body: { email },
    });
    assert.equal(res.status, 201);
  }

  // 2 members + 2 pending invites = full.
  const overflow = await request(`/api/groups/${group.id}/invites`, {
    method: 'POST',
    token: leadToken,
    body: { email: 'c@test.edu' },
  });
  assert.equal(overflow.status, 409);
  assert.match(overflow.body.error, /No free seats/);
});

test('a revoked invite cannot be accepted', { skip }, async () => {
  const { group, leadToken } = await pairFixture();
  const created = await request(`/api/groups/${group.id}/invites`, {
    method: 'POST',
    token: leadToken,
    body: {},
  });

  const revoked = await request(
    `/api/groups/${group.id}/invites/${created.body.invite.id}`,
    { method: 'DELETE', token: leadToken }
  );
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.invite.state, 'revoked');
  assert.equal(revoked.body.invite.token, undefined, 'a spent invite hides its token');

  const joiner = await makeStudent('late@test.edu');
  const attempt = await request(`/api/invites/${created.body.invite.token}/accept`, {
    method: 'POST',
    token: joiner.token,
  });
  assert.equal(attempt.status, 409);
});

test('only the lead can create invites', { skip }, async () => {
  const { group } = await pairFixture();
  const notLead = signToken({ sub: group.memberIds[1], role: 'student' });

  const res = await request(`/api/groups/${group.id}/invites`, {
    method: 'POST',
    token: notLead,
    body: {},
  });
  assert.equal(res.status, 403);
});

test('a student already in a group for the semester cannot accept', { skip }, async () => {
  const { group, leadToken } = await pairFixture();
  const other = await makeGroup(pool, { name: 'Other', semester: SEMESTER, cgpas: [7.0] });

  const created = await request(`/api/groups/${group.id}/invites`, {
    method: 'POST',
    token: leadToken,
    body: {},
  });

  const res = await request(`/api/invites/${created.body.invite.token}/accept`, {
    method: 'POST',
    token: signToken({ sub: other.memberIds[0], role: 'student' }),
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /already in a group/);
});

test('an invite cannot be used to join a group of another gender', { skip }, async () => {
  const { group, leadToken } = await pairFixture(); // boys' group by default

  const created = await request(`/api/groups/${group.id}/invites`, {
    method: 'POST',
    token: leadToken,
    body: {},
  });

  const girl = await makeStudent('anika@test.edu', 8.5, 'female');
  const rejected = await request(`/api/invites/${created.body.invite.token}/accept`, {
    method: 'POST',
    token: girl.token,
  });

  assert.equal(rejected.status, 403);
  assert.match(rejected.body.error, /single-gender|boys'/);

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM group_members WHERE group_id = $1',
    [group.id]
  );
  assert.equal(rows[0].n, 2, 'the group is unchanged');
});

test('a student with no gender set cannot join a group', { skip }, async () => {
  const { group, leadToken } = await pairFixture();
  const created = await request(`/api/groups/${group.id}/invites`, {
    method: 'POST',
    token: leadToken,
    body: {},
  });

  const { rows } = await pool.query(
    `INSERT INTO students (email, name, cgpa) VALUES ('nogender@test.edu', 'No Gender', 8)
     RETURNING id`
  );
  const res = await request(`/api/invites/${created.body.invite.token}/accept`, {
    method: 'POST',
    token: signToken({ sub: rows[0].id, role: 'student' }),
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /gender/);
});

// --- role split -------------------------------------------------------------

async function makeCaretaker(hostelId) {
  const { rows } = await pool.query(
    `INSERT INTO admins (email, name, role, hostel_id)
     VALUES ($1, 'Caretaker', 'caretaker', $2) RETURNING id`,
    [`caretaker.${Date.now()}@test.edu`, hostelId]
  );
  return signToken({ sub: rows[0].id, role: 'caretaker', hostelId });
}

test('a caretaker cannot run the college-wide allotment', { skip }, async () => {
  const hostel = await makeHostel(pool, 'Hostel A', 'HA');
  const token = await makeCaretaker(hostel.id);

  const res = await request('/api/admin/allocate', {
    method: 'POST',
    token,
    body: { semester: SEMESTER },
  });
  assert.equal(res.status, 403);
});

test('a caretaker only sees and edits their own hostel', { skip }, async () => {
  const mine = await makeHostel(pool, 'Hostel A', 'HA');
  const theirs = await makeHostel(pool, 'Hostel B', 'HB');
  const fourSeater = await makeRoomType(pool, '4-seater', 4);

  const { rows: myRoom } = await pool.query(
    `INSERT INTO rooms (hostel_id, room_type_id, room_number) VALUES ($1, $2, 'HA-101') RETURNING id`,
    [mine.id, fourSeater.id]
  );
  const { rows: theirRoom } = await pool.query(
    `INSERT INTO rooms (hostel_id, room_type_id, room_number) VALUES ($1, $2, 'HB-101') RETURNING id`,
    [theirs.id, fourSeater.id]
  );

  const token = await makeCaretaker(mine.id);

  const occupancy = await request('/api/admin/occupancy', { token });
  assert.equal(occupancy.status, 200);
  assert.deepEqual(
    [...new Set(occupancy.body.breakdown.map((r) => r.hostel))],
    ['Hostel A'],
    'occupancy is scoped to their hostel'
  );

  assert.equal(
    (
      await request(`/api/catalog/rooms/${myRoom[0].id}/status`, {
        method: 'PATCH',
        token,
        body: { status: 'maintenance' },
      })
    ).status,
    200
  );

  const blocked = await request(`/api/catalog/rooms/${theirRoom[0].id}/status`, {
    method: 'PATCH',
    token,
    body: { status: 'maintenance' },
  });
  assert.equal(blocked.status, 403);
});

test('the admin queue sorts by CGPA and reports readiness', { skip }, async () => {
  const hostel = await makeHostel(pool, 'Hostel A', 'HA');
  const fourSeater = await makeRoomType(pool, '4-seater', 4);

  await makeGroup(pool, {
    name: 'Low',
    semester: SEMESTER,
    cgpas: [6, 6, 6, 6],
    prefs: [[hostel, fourSeater]],
  });
  await makeGroup(pool, {
    name: 'High',
    semester: SEMESTER,
    cgpas: [9, 9, 9, 9],
    prefs: [[hostel, fourSeater]],
  });
  // Complete but no preferences -- not ready to allot.
  await makeGroup(pool, { name: 'NoPrefs', semester: SEMESTER, cgpas: [8, 8, 8, 8] });

  const { rows } = await pool.query(
    `INSERT INTO admins (email, name, role) VALUES ('a@test.edu', 'A', 'admin') RETURNING id`
  );
  const token = signToken({ sub: rows[0].id, role: 'admin' });

  const desc = await request('/api/admin/groups', { token });
  assert.equal(desc.status, 200);
  assert.deepEqual(
    desc.body.groups.map((g) => g.name),
    ['High', 'NoPrefs', 'Low'],
    'defaults to CGPA descending -- the order allotment processes them in'
  );
  assert.equal(desc.body.readyToAllot, 2, 'the group with no preferences is not ready');
  assert.equal(desc.body.counts.active, 3);

  const asc = await request('/api/admin/groups?sort=cgpa&order=asc', { token });
  assert.deepEqual(asc.body.groups.map((g) => g.name), ['Low', 'NoPrefs', 'High']);

  // An unknown sort key is rejected rather than reaching SQL.
  const bad = await request('/api/admin/groups?sort=%3Bdrop', { token });
  assert.equal(bad.status, 400);
});
