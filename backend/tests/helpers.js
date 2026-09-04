/**
 * Test fixtures. Every helper writes through the real pool so the tests
 * exercise the actual schema constraints, not a mock.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const TABLES = [
  'swap_audit_log',
  'swap_requests',
  'allotment_runs',
  'allotments',
  'preferences',
  'group_members',
  'groups',
  'rooms',
  'room_types',
  'admins',
  'hostels',
  'students',
];

export async function applySchema(pool) {
  const schema = await readFile(join(here, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
}

export async function resetDb(pool) {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function makeHostel(pool, name, code) {
  const { rows } = await pool.query(
    'INSERT INTO hostels (name, building_code) VALUES ($1, $2) RETURNING id, name',
    [name, code]
  );
  return rows[0];
}

export async function makeRoomType(pool, name, capacity) {
  const { rows } = await pool.query(
    'INSERT INTO room_types (name, capacity) VALUES ($1, $2) RETURNING id, name, capacity',
    [name, capacity]
  );
  return rows[0];
}

export async function makeRoom(pool, hostel, roomType, roomNumber, status = 'active') {
  const { rows } = await pool.query(
    `INSERT INTO rooms (hostel_id, room_type_id, room_number, status)
     VALUES ($1, $2, $3, $4) RETURNING id, room_number, status`,
    [hostel.id, roomType.id, roomNumber, status]
  );
  return rows[0];
}

let studentSeq = 0;

/**
 * Creates a group with one student per CGPA in `cgpas`, and preferences in the
 * order given as [hostel, roomType] pairs.
 */
export async function makeGroup(pool, { name, semester, cgpas, prefs = [] }) {
  const memberIds = [];
  for (const cgpa of cgpas) {
    studentSeq += 1;
    const { rows } = await pool.query(
      `INSERT INTO students (email, name, cgpa)
       VALUES ($1, $2, $3) RETURNING id`,
      [`s${studentSeq}@test.edu`, `Student ${studentSeq}`, cgpa]
    );
    memberIds.push(rows[0].id);
  }

  const { rows: groupRows } = await pool.query(
    `INSERT INTO groups (name, group_lead_id, semester) VALUES ($1, $2, $3) RETURNING id`,
    [name, memberIds[0], semester]
  );
  const groupId = groupRows[0].id;

  for (const studentId of memberIds) {
    await pool.query(
      'INSERT INTO group_members (group_id, student_id) VALUES ($1, $2)',
      [groupId, studentId]
    );
  }

  for (const [index, [hostel, roomType]] of prefs.entries()) {
    await pool.query(
      `INSERT INTO preferences (group_id, rank, hostel_id, room_type_id)
       VALUES ($1, $2, $3, $4)`,
      [groupId, index + 1, hostel.id, roomType.id]
    );
  }

  return { id: groupId, name, memberIds };
}

export async function allotmentFor(pool, groupId, semester) {
  const { rows } = await pool.query(
    `SELECT a.matched_rank, r.room_number, h.name AS hostel_name
       FROM allotments a
       JOIN rooms r   ON r.id = a.room_id
       JOIN hostels h ON h.id = r.hostel_id
      WHERE a.group_id = $1 AND a.semester = $2`,
    [groupId, semester]
  );
  return rows[0] ?? null;
}

export async function groupStatus(pool, groupId) {
  const { rows } = await pool.query('SELECT status FROM groups WHERE id = $1', [groupId]);
  return rows[0].status;
}
