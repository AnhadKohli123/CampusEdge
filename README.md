# CampusEdge — Hostel Allotment System

Room allocation for a college with four hostels. Students form groups of four,
rank the hostel and room type they want, and an admin runs a batch job that
assigns rooms by group CGPA.

- **Backend** — Node.js + Express + PostgreSQL
- **Frontend** — React + TypeScript + Tailwind CSS (Vite)

---

## How allotment works

Groups are ranked by **average CGPA, highest first**. Ties break on creation
time, so an earlier group wins a tie. Walking that order, each group's
preferences are tried in rank order and it takes the first room still free.
A group that matches nothing is waitlisted.

```
sort groups by avg_cgpa DESC, created_at ASC
for each group:
    for each preference in rank order:
        room = first free room in (hostel, room_type)
        if room: allot, mark group 'allotted', stop
    else: mark group 'waitlist'
```

Three properties the implementation guarantees:

**Idempotent.** Only `active` groups and rooms with no allotment row for the
semester are considered. Re-running places newly-added groups without moving
anyone already placed — so it is safe to run again after late registrations.
Note this makes re-runs *incremental*, not a redo: a late group with a higher
CGPA does not evict an existing allotment, it takes what is left. To reallocate
from scratch, clear that semester's `allotments` and reset group statuses.

**Concurrency-safe.** The whole run is one `SERIALIZABLE` transaction guarded
by a semester-scoped advisory lock, so two admins pressing the button at once
queue rather than race. `UNIQUE(room_id, semester)` is the backstop, and
serialization failures are retried automatically.

**Semester-isolated.** Every allotment is scoped to a semester string, so the
same physical room is allotted independently each term.

### Room sizing

A group is only matched to a room whose **capacity equals the group size**.
Rooms are handed to one group whole ("empty rooms stay empty, no forced
pairing"), so a group of 4 in a 6-bed room would strand two beds and cannot fit
in a 2-bed room at all. The preferences API rejects any room type of another
capacity up front, rather than accepting a choice the algorithm would silently
never match. With `GROUP_SIZE=4`, only 4-capacity room types are allottable;
the smaller types are seeded for future group sizes.

---

## Running it locally

Requires Node 20+ and PostgreSQL 14+.

### 1. Database

```bash
createdb campusedge
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm install
npm run migrate               # apply db/schema.sql
npm run seed -- --demo        # 4 hostels, 200 rooms, staff login, sample groups
npm run dev                   # http://localhost:4000
```

`npm run seed` alone loads only reference data (hostels, room types, rooms and
a staff login). Add `--demo` for sample students and groups to try the batch
job against. Both are idempotent — re-seeding adds only what is missing.

Seeded logins:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@campusedge.edu` | `admin12345` |
| Caretaker | `caretaker.ha@campusedge.edu` | `admin12345` |
| Student (with `--demo`) | `student1@campusedge.edu` | `student123` |

Override with `SEED_ADMIN_PASSWORD` / `SEED_STUDENT_PASSWORD`. These are local
development credentials — do not seed them into a deployed database.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:4000` in dev, so no CORS setup is
needed. For a deployed frontend, set `VITE_API_BASE_URL` to the API origin.

### 4. Tests

```bash
cd backend
createdb campusedge_test
TEST_DATABASE_URL=postgres://localhost/campusedge_test npm test
```

The suite runs against a real database because the behaviour worth testing —
`SERIALIZABLE`, row locking, the unique constraints — does not exist in a mock.
**It truncates every table before each test, so never point it at a database
you care about.** Without `TEST_DATABASE_URL` set, the suite skips rather than
fails.

---

## API

Auth is a JWT bearer token from a login endpoint. Student and staff tokens
carry different roles; `/api/admin/*` requires `admin` or `caretaker`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/student/signup` | — | Register, returns token |
| `POST` | `/api/auth/student/login` | — | Student login |
| `POST` | `/api/auth/admin/login` | — | Staff login |
| `GET` | `/api/students` | — | List / search students |
| `GET` | `/api/students/me` | student | Own profile |
| `PATCH` | `/api/students/:id` | self or admin | Update profile |
| `POST` | `/api/groups` | student | Create a group (caller becomes lead) |
| `GET` | `/api/groups/mine` | student | Caller's group this semester |
| `GET` | `/api/groups/:id` | — | Group with members |
| `POST` | `/api/groups/:id/members` | lead | Add a member |
| `DELETE` | `/api/groups/:id/members/:studentId` | lead | Remove a member |
| `GET` | `/api/groups/:id/preferences` | — | Current ranking |
| `PUT` | `/api/groups/:id/preferences` | lead | Replace ranking (array order = rank) |
| `GET` | `/api/catalog/hostels` | — | Hostels |
| `GET` | `/api/catalog/room-types` | — | Room types |
| `GET` | `/api/catalog/rooms` | — | Rooms, filterable |
| `PATCH` | `/api/catalog/rooms/:id/status` | staff | Maintenance toggle |
| `POST` | `/api/groups/:id/invites` | lead | Create an invite (optionally email-bound) |
| `GET` | `/api/groups/:id/invites` | lead | List invites and their state |
| `DELETE` | `/api/groups/:id/invites/:inviteId` | lead | Revoke a pending invite |
| `GET` | `/api/invites/:token` | — | Preview an invite (works signed out) |
| `POST` | `/api/invites/:token/accept` | student | Join the group |
| `GET` | `/api/allotments` | — | All allotments for a semester |
| `GET` | `/api/allotments/mine` | student | Caller's result |
| `GET` | `/api/admin/groups` | staff | Allotment queue, sortable by CGPA |
| `POST` | `/api/admin/allocate` | **admin** | **Run the batch job** |
| `GET` | `/api/admin/occupancy` | staff | Occupancy (caretakers: own hostel) |
| `GET` | `/api/admin/waitlist` | staff | Waitlisted groups by CGPA |
| `GET` | `/api/admin/allotment-runs` | staff | Run history and summaries |

---

## Roles

| | Student | Caretaker | Admin |
|---|:---:|:---:|:---:|
| Form a group, invite members | ● | | |
| Rank preferences | ● | | |
| See own allotment result | ● | | |
| View the allotment queue | | ● | ● |
| Occupancy | | own hostel | all hostels |
| Flag a room for maintenance | | own hostel | all hostels |
| **Run the batch allotment** | | | ● |

A caretaker looks after one hostel, so their occupancy view is scoped to it and
they cannot flag rooms elsewhere or start a college-wide allocation. The UI
hides what the API would refuse, rather than showing a button that 403s.

### Joining a group by link

A group lead invites people two ways:

- **By email** — the invite is bound to that address, and only a student signed
  in with it can accept. Safe to send to one person.
- **Open link** — anyone holding the link can accept. Meant for a group chat.

Either way the recipient opens `/join/<token>`, which renders signed out so it
can say who invited them and how many seats are left before asking them to log
in. Signing up through the link returns them to the invite to accept it.

Invites expire after `INVITE_TTL_DAYS` (7 by default), are single-use, and can
be revoked by the lead. **Pending invites count against the group size**, so a
lead cannot send six links for two free seats and leave four people with a
confusing error — the seats are held until the invite is used, revoked, or
expires.

Nothing is actually emailed yet: the API returns a link for the lead to share.
Wiring an SMTP provider in is Phase 3 (notifications); `group_invites.email`
already carries the address to send to.

## Rules enforced

- A group must have exactly `GROUP_SIZE` (default 4) members to be allotted;
  smaller groups are waitlisted with a reason.
- A student belongs to at most one group per semester (enforced by a unique
  index, not just application code).
- Only the group lead can change membership or preferences.
- Once a group is allotted, **membership and preferences are locked** — dropping
  a member would leave a room short of occupants. Changes after allotment go
  through an admin swap.
- Rooms in `maintenance` or `reserved` are never allotted.
- An invite is single-use, expires, and holds a seat while pending.
- Only an admin can run the allotment; caretakers are scoped to one hostel.
- Every batch run is recorded in `allotment_runs` with its summary, who
  triggered it, and any error.

---

## Schema notes

The schema follows the original spec with three deliberate changes:

1. **`cgpa` is `DECIMAL(4,2)`, not `DECIMAL(3,2)`.** `DECIMAL(3,2)` holds at
   most `9.99` and throws `numeric field overflow` on a perfect `10.00`. This
   was caught by a test using a 10.0 CGPA.
2. **`password_hash` added** to `students` and `admins`, since the MVP needs a
   login screen. Nullable, so students can be bulk-imported from the registrar
   and set a password later.
3. **`allotment_runs` added** — an audit row per batch run. `swap_audit_log` is
   likewise in place for the Phase 2 swap flow.
4. **`group_invites` added** for join-by-link. A partial unique index keeps at
   most one *live* invite per email per group, so re-inviting someone replaces
   the old link rather than leaving several valid at once.

`group_members` carries a denormalised `semester` column, maintained by a
trigger, purely so the "one group per student per semester" rule can be a real
unique index rather than an application check that races.

---

## Status

**Phase 1 (MVP) is complete**: schema and seed data, student auth, group
formation with invite links, preference ranking, the batch allotment job,
result view, the admin allotment queue, and the trigger page with occupancy and
run history. The interface is a dark navy theme throughout.

**Phase 2** — swap request queue with approve/reject, occupancy heatmap,
allotment rollback per semester, and CSV/PDF export — is not built. The
`swap_requests` and `swap_audit_log` tables and the room maintenance toggle are
already in place to support it.

Not implemented from the original stack list: **Redis + Bull**. The batch job
runs inline inside the request, which finishes well under a request timeout at
college scale. `POST /api/admin/allocate` is where a queue would slot in — it
would return `202` plus a run id, and `allotment_runs` already gives the client
something to poll.
