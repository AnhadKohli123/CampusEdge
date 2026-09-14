#!/usr/bin/env node
/**
 * Seeds the reference data the app cannot run without: hostels, the room type
 * catalogue, rooms, and a staff login.
 *
 * Idempotent -- every insert is ON CONFLICT DO NOTHING, so re-seeding an
 * existing database adds only what is missing.
 *
 *   npm run seed                 reference data only
 *   npm run seed -- --demo       + 6 sample groups (quick smoke test)
 *   npm run seed -- --dataset    + 200 students across 49 groups (realistic)
 */
import bcrypt from 'bcryptjs';
import { closePool, withTransaction } from '../src/db.js';
import { config } from '../src/config.js';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

// Two boys' blocks and two girls' blocks. Room supply is deliberately balanced
// at 18 capacity-4 rooms each, so neither side is structurally disadvantaged.
const HOSTELS = [
  { name: 'Hostel A', code: 'HA', gender: 'male' },
  { name: 'Hostel B', code: 'HB', gender: 'male' },
  { name: 'Hostel C', code: 'HC', gender: 'female' },
  { name: 'Hostel D', code: 'HD', gender: 'female' },
];

const ROOM_TYPES = [
  { name: 'Single AC', capacity: 1 },
  { name: 'Single Non-AC', capacity: 1 },
  { name: '2-seater AC', capacity: 2 },
  { name: '2-seater Non-AC', capacity: 2 },
  { name: '3-seater AC', capacity: 3 },
  { name: '3-seater Non-AC', capacity: 3 },
  // Capacity 4 is the allottable tier at GROUP_SIZE=4, so it carries the most
  // variety -- these are what groups actually compete over.
  { name: '4-seater AC Premium', capacity: 4 },
  { name: '4-seater AC', capacity: 4 },
  { name: '4-seater Balcony', capacity: 4 },
  { name: '4-seater Corner', capacity: 4 },
  { name: '4-seater Non-AC', capacity: 4 },
];

/**
 * Rooms per hostel. Deliberately uneven: A is the premium block, D is the
 * budget block, so preferences genuinely compete instead of every hostel being
 * interchangeable. The capacity-4 rooms total 36 against 40 complete groups in
 * the dataset, which is what produces a realistic waitlist.
 */
const HOSTEL_ROOM_PLAN = {
  // Boys' blocks
  HA: {
    'Single AC': 6, '2-seater AC': 6, '3-seater AC': 4,
    '4-seater AC Premium': 4, '4-seater AC': 3, '4-seater Balcony': 2,
  },
  HB: {
    'Single AC': 3, 'Single Non-AC': 4, '2-seater AC': 4, '2-seater Non-AC': 4,
    '3-seater AC': 3,
    '4-seater AC': 3, '4-seater Non-AC': 4, '4-seater Corner': 2,
  },
  // Girls' blocks
  HC: {
    'Single AC': 4, 'Single Non-AC': 4, '2-seater AC': 5, '2-seater Non-AC': 4,
    '3-seater AC': 4,
    '4-seater AC': 3, '4-seater Non-AC': 4, '4-seater Balcony': 2,
  },
  HD: {
    'Single Non-AC': 6, '2-seater Non-AC': 8, '3-seater Non-AC': 6,
    '4-seater AC Premium': 2, '4-seater Non-AC': 5, '4-seater Corner': 2,
  },
};

/** A handful of rooms out of service, so occupancy is not uniformly clean. */
const OUT_OF_SERVICE = [
  { room: 'HA-103', status: 'maintenance' },
  { room: 'HB-207', status: 'maintenance' },
  { room: 'HC-105', status: 'reserved' },
  { room: 'HD-301', status: 'maintenance' },
];

const DEMO_PASSWORD = process.env.SEED_STUDENT_PASSWORD ?? 'student123';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';

async function seedReferenceData(client) {
  for (const hostel of HOSTELS) {
    await client.query(
      `INSERT INTO hostels (name, building_code, gender) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET gender = EXCLUDED.gender`,
      [hostel.name, hostel.code, hostel.gender]
    );
  }
  for (const type of ROOM_TYPES) {
    await client.query(
      `INSERT INTO room_types (name, capacity) VALUES ($1, $2)
       ON CONFLICT (name) DO NOTHING`,
      [type.name, type.capacity]
    );
  }

  const { rows: hostels } = await client.query(
    'SELECT id, name, building_code, gender FROM hostels'
  );
  const { rows: types } = await client.query('SELECT id, name FROM room_types');
  const typeByName = new Map(types.map((t) => [t.name, t]));

  let roomCount = 0;
  for (const hostel of hostels) {
    const plan = HOSTEL_ROOM_PLAN[hostel.building_code] ?? {};
    // Rooms are numbered by floor, ten to a floor: HA-101..HA-110, HA-201...
    let index = 0;
    for (const [typeName, count] of Object.entries(plan)) {
      const type = typeByName.get(typeName);
      if (!type) continue;
      for (let i = 0; i < count; i += 1) {
        const floor = Math.floor(index / 10) + 1;
        const roomNumber = `${hostel.building_code}-${floor}${String((index % 10) + 1).padStart(2, '0')}`;
        index += 1;
        const { rowCount } = await client.query(
          `INSERT INTO rooms (hostel_id, room_type_id, room_number) VALUES ($1, $2, $3)
           ON CONFLICT (hostel_id, room_number) DO NOTHING`,
          [hostel.id, type.id, roomNumber]
        );
        roomCount += rowCount;
      }
    }
  }

  for (const { room, status } of OUT_OF_SERVICE) {
    await client.query('UPDATE rooms SET status = $2 WHERE room_number = $1', [room, status]);
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

  return { hostels: hostels.length, roomTypes: ROOM_TYPES.length, newRooms: roomCount };
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

/** Deterministic PRNG, so the dataset is identical on every machine. */
function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MALE_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna',
  'Ishaan', 'Kabir', 'Rohan', 'Dhruv', 'Yash', 'Aryan', 'Kunal', 'Nikhil',
  'Rahul', 'Siddharth', 'Karan', 'Manav',
];

const FEMALE_NAMES = [
  'Ananya', 'Diya', 'Aadhya', 'Ishita', 'Saanvi', 'Myra', 'Aarohi', 'Anika',
  'Navya', 'Riya', 'Meera', 'Kavya', 'Tara', 'Nitya', 'Sneha', 'Pooja',
  'Rhea', 'Trisha', 'Neha', 'Shreya',
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Menon', 'Rao',
  'Gupta', 'Singh', 'Kapoor', 'Malhotra', 'Bose', 'Chatterjee', 'Desai',
  'Joshi', 'Kulkarni', 'Bhat', 'Pillai', 'Sinha', 'Mehta', 'Shah', 'Kohli',
  'Banerjee', 'Chauhan',
];

/**
 * CGPA on a roughly normal curve (Box-Muller), centred at 7.6 and clamped to
 * the 5.0-10.0 range a hostel applicant realistically has. A uniform spread
 * would make the CGPA ranking meaningless -- real cohorts bunch in the middle.
 */
function sampleCgpa(random) {
  const u = Math.max(random(), 1e-9);
  const v = random();
  const gaussian = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const value = 7.6 + gaussian * 0.95;
  return Number(Math.min(10, Math.max(5, value)).toFixed(2));
}

const pick = (random, list) => list[Math.floor(random() * list.length)];

async function insertStudent(client, random, seq, passwordHash, gender) {
  const first = pick(random, gender === 'male' ? MALE_NAMES : FEMALE_NAMES);
  const last = pick(random, LAST_NAMES);
  // The sequence number keeps the email unique when a name repeats.
  const email = `${first}.${last}${seq}@campusedge.edu`.toLowerCase();
  const { rows } = await client.query(
    `INSERT INTO students (email, name, password_hash, cgpa, gender, phone)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET cgpa = EXCLUDED.cgpa, gender = EXCLUDED.gender
     RETURNING id`,
    [
      email,
      `${first} ${last}`,
      passwordHash,
      sampleCgpa(random),
      gender,
      `9${String(800000000 + seq * 137).slice(0, 9)}`,
    ]
  );
  return rows[0].id;
}

async function createGroup(client, { name, semester, gender, memberIds, preferences }) {
  const { rows: existing } = await client.query(
    'SELECT id FROM groups WHERE name = $1 AND semester = $2',
    [name, semester]
  );
  if (existing.length > 0) return null;

  const { rows } = await client.query(
    `INSERT INTO groups (name, group_lead_id, gender, semester)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, memberIds[0], gender, semester]
  );
  const groupId = rows[0].id;

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

  for (const [index, pref] of preferences.entries()) {
    await client.query(
      `INSERT INTO preferences (group_id, rank, hostel_id, room_type_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [groupId, index + 1, pref.hostelId, pref.roomTypeId]
    );
  }
  return groupId;
}

/**
 * 200 students in a shape that exercises every branch of the allotment:
 * complete groups that compete for scarce rooms, groups too small to qualify,
 * groups that never submitted preferences, and students who never joined one.
 */
async function seedDataset(client) {
  const semester = config.currentSemester;
  const random = mulberry32(20240215);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const { rows: hostels } = await client.query(
    'SELECT id, name, gender FROM hostels ORDER BY name'
  );
  // Every capacity is allottable now: a pair takes a 2-seater, a trio a
  // 3-seater, a lone student a single.
  const { rows: allRoomTypes } = await client.query(
    'SELECT id, name, capacity FROM room_types ORDER BY capacity, name'
  );
  const typesByCapacity = new Map();
  for (const type of allRoomTypes) {
    if (!typesByCapacity.has(type.capacity)) typesByCapacity.set(type.capacity, []);
    typesByCapacity.get(type.capacity).push(type);
  }
  const hostelsByGender = {
    male: hostels.filter((h) => h.gender === 'male'),
    female: hostels.filter((h) => h.gender === 'female'),
  };

  // Everyone wants AC and a balcony, so those appear near the top of most
  // lists. Scarcity then resolves by CGPA, which is the whole point.
  // Everyone wants AC, so AC types appear more often near the top of a list.
  const POPULARITY = {
    '4-seater AC Premium': 5,
    '4-seater Balcony': 4,
    '4-seater AC': 4,
    '4-seater Corner': 2,
    '4-seater Non-AC': 1,
    '3-seater AC': 4,
    '3-seater Non-AC': 1,
    '2-seater AC': 4,
    '2-seater Non-AC': 1,
    'Single AC': 4,
    'Single Non-AC': 1,
  };
  const weightedByCapacity = new Map(
    [...typesByCapacity].map(([capacity, types]) => [
      capacity,
      types.flatMap((type) =>
        Array.from({ length: POPULARITY[type.name] ?? 1 }, () => type)
      ),
    ])
  );

  // Only the group's own blocks -- a girls' group ranking a boys' hostel would
  // be rejected by the API, so the dataset must not contain one.
  /** Preferences for a group of `size`: only rooms that actually fit it. */
  function buildPreferences(count, gender, size) {
    const options = hostelsByGender[gender];
    const roomOptions = weightedByCapacity.get(size) ?? [];
    if (roomOptions.length === 0) return [];
    const seen = new Set();
    const list = [];
    let guard = 0;
    while (list.length < count && guard < 200) {
      guard += 1;
      const hostel = pick(random, options);
      const roomType = pick(random, roomOptions);
      const key = `${hostel.id}:${roomType.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ hostelId: hostel.id, roomTypeId: roomType.id });
    }
    return list;
  }

  const TEAM_WORDS = [
    'Falcon', 'Nova', 'Orbit', 'Pulse', 'Quest', 'Rift', 'Summit', 'Vertex',
    'Zenith', 'Apex', 'Bolt', 'Cobalt', 'Delta', 'Ember', 'Flux', 'Gale',
    'Helix', 'Ion', 'Jet', 'Kite', 'Lumen', 'Mirage', 'Nimbus', 'Onyx',
    'Prism', 'Quartz', 'Ridge', 'Solstice', 'Titan', 'Umbra', 'Vortex',
    'Willow', 'Xenon', 'Yonder', 'Zephyr', 'Aurora', 'Beacon', 'Cinder',
    'Dune', 'Echo', 'Forge', 'Grove', 'Harbor', 'Isle', 'Juniper', 'Keystone',
    'Lantern', 'Meridian', 'Nomad',
  ];

  // 40 complete groups (160) + 20 in undersized groups + 20 unGrouped = 200.
  const PLAN = [
    ...Array.from({ length: 40 }, () => 4),
    3, 3, 3, 3,
    2, 2, 2,
    1, 1,
  ];

  let seq = 0;
  let studentsCreated = 0;
  let groupsCreated = 0;
  let withoutPreferences = 0;

  let maleGroups = 0;
  let femaleGroups = 0;

  for (const [index, size] of PLAN.entries()) {
    // Alternate so the cohort is close to evenly split.
    const gender = index % 2 === 0 ? 'male' : 'female';
    if (gender === 'male') maleGroups += 1;
    else femaleGroups += 1;

    const memberIds = [];
    for (let i = 0; i < size; i += 1) {
      seq += 1;
      memberIds.push(await insertStudent(client, random, seq, passwordHash, gender));
      studentsCreated += 1;
    }

    // A few groups never get round to submitting preferences.
    const skipPreferences = index % 13 === 5;
    if (skipPreferences) withoutPreferences += 1;

    // Preference lists vary from a narrow 2 to a thorough 10; a short list is
    // the other realistic way to end up waitlisted.
    const count = skipPreferences ? 0 : 2 + Math.floor(random() * 9);

    const created = await createGroup(client, {
      name: `Team ${TEAM_WORDS[index % TEAM_WORDS.length]}`,
      semester,
      gender,
      memberIds,
      preferences: buildPreferences(count, gender, size),
    });
    if (created) groupsCreated += 1;
  }

  // Students who never joined a group at all.
  let ungrouped = 0;
  while (studentsCreated < 200) {
    seq += 1;
    await insertStudent(client, random, seq, passwordHash, ungrouped % 2 ? 'male' : 'female');
    studentsCreated += 1;
    ungrouped += 1;
  }

  const { rows: firstStudent } = await client.query(
    'SELECT email FROM students ORDER BY created_at ASC LIMIT 1'
  );

  return {
    semester,
    students: studentsCreated,
    groups: groupsCreated,
    groupsBySize: PLAN.reduce((acc, n) => ({ ...acc, [n]: (acc[n] ?? 0) + 1 }), {}),
    withoutPreferences,
    ungrouped,
    maleGroups,
    femaleGroups,
    sampleLogin: firstStudent[0]?.email,
  };
}

/** The original six-group sample, kept as a fast smoke test. */
async function seedDemoData(client) {
  const semester = config.currentSemester;
  const random = mulberry32(7);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const { rows: hostels } = await client.query(
    'SELECT id, name, gender FROM hostels ORDER BY name'
  );
  const { rows: fourSeaters } = await client.query(
    'SELECT id, name FROM room_types WHERE capacity = $1 ORDER BY name',
    [config.maxGroupSize]
  );

  const demoGroups = [
    { name: 'Team Falcon', cgpas: [9.4, 9.1, 8.8, 9.0] },
    { name: 'Team Nova', cgpas: [8.9, 8.7, 8.5, 8.6] },
    { name: 'Team Orbit', cgpas: [8.2, 8.0, 7.9, 8.1] },
    { name: 'Team Pulse', cgpas: [7.6, 7.4, 7.8, 7.2] },
    { name: 'Team Quest', cgpas: [7.0, 6.8, 7.1, 6.9] },
    { name: 'Team Rift', cgpas: [6.5, 6.2, 6.4, 6.0] },
  ];

  let seq = 0;
  let created = 0;
  for (const [groupIndex, spec] of demoGroups.entries()) {
    const gender = groupIndex % 2 === 0 ? 'male' : 'female';
    const names = gender === 'male' ? MALE_NAMES : FEMALE_NAMES;
    const ownHostels = hostels.filter((h) => h.gender === gender);

    const memberIds = [];
    for (const cgpa of spec.cgpas) {
      seq += 1;
      const { rows } = await client.query(
        `INSERT INTO students (email, name, password_hash, cgpa, gender, phone)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO UPDATE SET cgpa = EXCLUDED.cgpa, gender = EXCLUDED.gender
         RETURNING id`,
        [
          `student${seq}@campusedge.edu`,
          `${pick(random, names)} ${pick(random, LAST_NAMES)}`,
          passwordHash,
          cgpa,
          gender,
          `98000000${String(seq).padStart(2, '0')}`,
        ]
      );
      memberIds.push(rows[0].id);
    }

    const preferences = [];
    for (let h = 0; h < ownHostels.length; h += 1) {
      const hostel = ownHostels[(groupIndex + h) % ownHostels.length];
      for (const roomType of fourSeaters) {
        preferences.push({ hostelId: hostel.id, roomTypeId: roomType.id });
      }
    }

    const id = await createGroup(client, {
      name: spec.name,
      semester,
      gender,
      memberIds,
      preferences,
    });
    if (id) created += 1;
  }

  return { groups: created, students: seq, semester };
}

// ---------------------------------------------------------------------------

async function run() {
  const wantsDemo = process.argv.includes('--demo');
  const wantsDataset = process.argv.includes('--dataset');

  const reference = await withTransaction(seedReferenceData);
  console.log(
    `[seed] hostels=${reference.hostels} roomTypes=${reference.roomTypes} newRooms=${reference.newRooms}`
  );
  console.log(`[seed] admin login: admin@campusedge.edu / ${ADMIN_PASSWORD}`);

  if (wantsDataset) {
    const data = await withTransaction(seedDataset);
    console.log(
      `[seed] dataset: ${data.students} students, ${data.groups} groups for ${data.semester}`
    );
    console.log(
      `[seed]   sizes: ` +
        Object.entries(data.groupsBySize)
          .map(([size, n]) => `${n}x${size}-person`)
          .join(', ') +
        `, ${data.withoutPreferences} without preferences, ${data.ungrouped} ungrouped`
    );
    console.log(
      `[seed]   ${data.maleGroups} boys' groups, ${data.femaleGroups} girls' groups`
    );
    console.log(`[seed]   student login: ${data.sampleLogin} / ${DEMO_PASSWORD}`);
  } else if (wantsDemo) {
    const demo = await withTransaction(seedDemoData);
    console.log(
      `[seed] demo: ${demo.groups} groups, ${demo.students} students for ${demo.semester}`
    );
    console.log(`[seed]   student login: student1@campusedge.edu / ${DEMO_PASSWORD}`);
  }
}

run()
  .catch((err) => {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(closePool);
