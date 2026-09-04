#!/usr/bin/env node
/**
 * Seeds the reference data the app cannot run without: 4 hostels, the room
 * type catalogue, rooms in every hostel, and a staff login.
 *
 * Idempotent -- every insert is ON CONFLICT DO NOTHING, so re-seeding an
 * existing database adds only what is missing.
 *
 * Pass --demo to also create sample students, groups and preferences, which is
 * what you want before trying the allotment button locally.
 */
import bcrypt from 'bcryptjs';
import { pool, closePool, withTransaction } from '../src/db.js';
import { config } from '../src/config.js';

const HOSTELS = [
  { name: 'Hostel A', code: 'HA' },
  { name: 'Hostel B', code: 'HB' },
  { name: 'Hostel C', code: 'HC' },
  { name: 'Hostel D', code: 'HD' },
];

const ROOM_TYPES = [
  { name: 'Single AC', capacity: 1 },
  { name: 'Single Non-AC', capacity: 1 },
  { name: '2-seater AC', capacity: 2 },
  { name: '2-seater Non-AC', capacity: 2 },
  { name: '3-seater', capacity: 3 },
  { name: '4-seater AC', capacity: 4 },
  { name: '4-seater Non-AC', capacity: 4 },
];

// How many rooms of each type each hostel gets. Deliberately tight on
// 4-capacity rooms so a demo run produces a realistic waitlist.
const ROOMS_PER_HOSTEL = {
  'Single AC': 4,
  'Single Non-AC': 6,
  '2-seater AC': 6,
  '2-seater Non-AC': 8,
  '3-seater': 6,
  '4-seater AC': 8,
  '4-seater Non-AC': 12,
};

const DEMO_PASSWORD = process.env.SEED_STUDENT_PASSWORD ?? 'student123';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';

async function seedReferenceData(client) {
  for (const hostel of HOSTELS) {
    await client.query(
      `INSERT INTO hostels (name, building_code) VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [hostel.name, hostel.code]
    );
  }

  for (const type of ROOM_TYPES) {
    await client.query(
      `INSERT INTO room_types (name, capacity) VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [type.name, type.capacity]
    );
  }

  const { rows: hostels } = await client.query('SELECT id, name, building_code FROM hostels');
  const { rows: types } = await client.query('SELECT id, name, capacity FROM room_types');

  let roomCount = 0;
  for (const hostel of hostels) {
    let floorSeq = 1;
    for (const type of types) {
      const count = ROOMS_PER_HOSTEL[type.name] ?? 0;
      for (let i = 0; i < count; i += 1) {
        // e.g. HA-101, HA-102 ... readable and unique within the hostel.
        const roomNumber = `${hostel.building_code}-${100 + floorSeq}`;
        floorSeq += 1;
        const { rowCount } = await client.query(
          `INSERT INTO rooms (hostel_id, room_type_id, room_number) VALUES ($1, $2, $3)
           ON CONFLICT (hostel_id, room_number) DO NOTHING`,
          [hostel.id, type.id, roomNumber]
        );
        roomCount += rowCount;
      }
    }
  }

  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await client.query(
    `INSERT INTO admins (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO NOTHING`,
    ['admin@campusedge.edu', 'Hostel Administrator', adminHash]
  );

  for (const hostel of hostels) {
    await client.query(
      `INSERT INTO admins (email, name, password_hash, role, hostel_id)
       VALUES ($1, $2, $3, 'caretaker', $4)
       ON CONFLICT (email) DO NOTHING`,
      [
        `caretaker.${hostel.building_code.toLowerCase()}@campusedge.edu`,
        `${hostel.name} Caretaker`,
        adminHash,
        hostel.id,
      ]
    );
  }

  return { hostels: hostels.length, roomTypes: types.length, newRooms: roomCount };
}

async function seedDemoData(client) {
  const semester = config.currentSemester;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Six groups of four chasing a deliberately limited pool of 4-bed rooms.
  const demoGroups = [
    { name: 'Team Falcon', cgpas: [9.4, 9.1, 8.8, 9.0] },
    { name: 'Team Nova', cgpas: [8.9, 8.7, 8.5, 8.6] },
    { name: 'Team Orbit', cgpas: [8.2, 8.0, 7.9, 8.1] },
    { name: 'Team Pulse', cgpas: [7.6, 7.4, 7.8, 7.2] },
    { name: 'Team Quest', cgpas: [7.0, 6.8, 7.1, 6.9] },
    { name: 'Team Rift', cgpas: [6.5, 6.2, 6.4, 6.0] },
  ];

  const { rows: hostels } = await client.query(
    'SELECT id, name FROM hostels ORDER BY name'
  );
  const { rows: fourSeaters } = await client.query(
    'SELECT id, name FROM room_types WHERE capacity = $1 ORDER BY name',
    [config.groupSize]
  );

  let studentSeq = 1;
  for (const [groupIndex, spec] of demoGroups.entries()) {
    const memberIds = [];
    for (const cgpa of spec.cgpas) {
      const email = `student${studentSeq}@campusedge.edu`;
      const { rows } = await client.query(
        `INSERT INTO students (email, name, password_hash, cgpa, phone)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET cgpa = EXCLUDED.cgpa
         RETURNING id`,
        [email, `Student ${studentSeq}`, passwordHash, cgpa, `98000000${studentSeq
          .toString()
          .padStart(2, '0')}`]
      );
      memberIds.push(rows[0].id);
      studentSeq += 1;
    }

    const { rows: existing } = await client.query(
      `SELECT g.id FROM groups g WHERE g.name = $1 AND g.semester = $2`,
      [spec.name, semester]
    );
    if (existing.length > 0) continue;

    const { rows: groupRows } = await client.query(
      `INSERT INTO groups (name, group_lead_id, semester) VALUES ($1, $2, $3) RETURNING id`,
      [spec.name, memberIds[0], semester]
    );
    const groupId = groupRows[0].id;

    for (const studentId of memberIds) {
      await client.query(
        'INSERT INTO group_members (group_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [groupId, studentId]
      );
    }
    await client.query(
      `UPDATE groups g SET avg_cgpa = sub.avg
         FROM (SELECT ROUND(AVG(s.cgpa), 2) AS avg
                 FROM group_members gm JOIN students s ON s.id = gm.student_id
                WHERE gm.group_id = $1) sub
        WHERE g.id = $1`,
      [groupId]
    );

    // Rotate the hostel order per group so preferences genuinely compete.
    let rank = 1;
    for (let h = 0; h < hostels.length; h += 1) {
      const hostel = hostels[(groupIndex + h) % hostels.length];
      for (const roomType of fourSeaters) {
        await client.query(
          `INSERT INTO preferences (group_id, rank, hostel_id, room_type_id)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [groupId, rank, hostel.id, roomType.id]
        );
        rank += 1;
      }
    }
  }

  return { groups: demoGroups.length, students: studentSeq - 1, semester };
}

async function run() {
  const withDemo = process.argv.includes('--demo');

  const reference = await withTransaction(seedReferenceData);
  console.log(
    `[seed] hostels=${reference.hostels} roomTypes=${reference.roomTypes} newRooms=${reference.newRooms}`
  );
  console.log(`[seed] admin login: admin@campusedge.edu / ${ADMIN_PASSWORD}`);

  if (withDemo) {
    const demo = await withTransaction(seedDemoData);
    console.log(
      `[seed] demo: ${demo.groups} groups, ${demo.students} students for ${demo.semester}`
    );
    console.log(`[seed] student login: student1@campusedge.edu / ${DEMO_PASSWORD}`);
  }
}

run()
  .catch((err) => {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(closePool);
