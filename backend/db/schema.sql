-- Hostel Allotment System - schema
-- Target: PostgreSQL 14+
--
-- Safe to re-run: every object is created with IF NOT EXISTS.
-- To wipe and recreate, run scripts/migrate.js --drop (see db/drop.sql).

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS students (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255) NOT NULL,
  -- password_hash is not in the original brief; it is required for the
  -- "student login/signup" MVP screen. Nullable so students can be bulk
  -- imported from the registrar and set a password later.
  password_hash VARCHAR(255),
  -- (4,2) not (3,2): DECIMAL(3,2) caps at 9.99 and overflows on a perfect 10.00
  cgpa          DECIMAL(4,2) CHECK (cgpa >= 0 AND cgpa <= 10),
  phone         VARCHAR(32),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hostels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) UNIQUE NOT NULL,
  building_code VARCHAR(32) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255),
  role          VARCHAR(20) NOT NULL DEFAULT 'admin'
                CHECK (role IN ('admin', 'caretaker')),
  -- caretakers are scoped to one hostel; admins are global (NULL)
  hostel_id     UUID REFERENCES hostels(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS room_types (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name     VARCHAR(120) UNIQUE NOT NULL,   -- "2-seater AC", "4-seater", ...
  capacity INT NOT NULL CHECK (capacity > 0)
);

CREATE TABLE IF NOT EXISTS rooms (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id         UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  room_type_id      UUID NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  room_number       VARCHAR(32) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'maintenance', 'reserved')),
  current_occupancy INT NOT NULL DEFAULT 0 CHECK (current_occupancy >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hostel_id, room_number)
);

CREATE INDEX IF NOT EXISTS rooms_lookup_idx
  ON rooms (hostel_id, room_type_id, status);

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120),
  group_lead_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  avg_cgpa      DECIMAL(4,2),   -- see students.cgpa for why (4,2)
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'allotted', 'waitlist')),
  semester      VARCHAR(32) NOT NULL,        -- e.g. "2024-Spring"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS groups_semester_status_idx
  ON groups (semester, status);

CREATE TABLE IF NOT EXISTS group_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS group_members_student_idx
  ON group_members (student_id);

-- A student may belong to at most one group per semester. The uniqueness has
-- to reach across the join, so it is enforced by a denormalised column kept in
-- sync by a trigger rather than by a plain UNIQUE constraint.
ALTER TABLE group_members
  ADD COLUMN IF NOT EXISTS semester VARCHAR(32);

CREATE OR REPLACE FUNCTION group_members_set_semester() RETURNS TRIGGER AS $$
BEGIN
  SELECT g.semester INTO NEW.semester FROM groups g WHERE g.id = NEW.group_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS group_members_semester_trg ON group_members;
CREATE TRIGGER group_members_semester_trg
  BEFORE INSERT OR UPDATE OF group_id ON group_members
  FOR EACH ROW EXECUTE FUNCTION group_members_set_semester();

CREATE UNIQUE INDEX IF NOT EXISTS group_members_one_group_per_semester_idx
  ON group_members (student_id, semester);

-- Invite links. A group lead generates one and shares it; the recipient opens
-- the link and joins. An invite may be bound to an email address, in which case
-- only a student with that email can accept it -- that is what makes a link
-- safe to send to one person rather than post in a group chat.
CREATE TABLE IF NOT EXISTS group_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token       VARCHAR(64) UNIQUE NOT NULL,
  email       VARCHAR(255),         -- NULL = anyone with the link may accept
  invited_by  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES students(id) ON DELETE SET NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_invites_group_idx ON group_invites (group_id);

-- At most one live invite per email per group, so re-inviting someone replaces
-- rather than accumulates. Partial, so spent invites do not block a re-invite.
CREATE UNIQUE INDEX IF NOT EXISTS group_invites_live_email_idx
  ON group_invites (group_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL AND email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS preferences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  rank         INT NOT NULL CHECK (rank > 0),
  hostel_id    UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  room_type_id UUID NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, rank),
  UNIQUE (group_id, hostel_id, room_type_id)   -- no duplicate choices
);

-- ---------------------------------------------------------------------------
-- Allotments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS allotments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  room_id     UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  semester    VARCHAR(32) NOT NULL,
  -- which preference rank was satisfied (NULL after an admin swap)
  matched_rank INT,
  allotted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, semester),    -- a room is held by one group per semester
  UNIQUE (group_id, semester)    -- a group holds one room per semester
);

CREATE INDEX IF NOT EXISTS allotments_semester_idx ON allotments (semester);

-- Per-semester switches the admin controls. Chiefly: results stay hidden from
-- students until they are published, so running the batch early -- or re-running
-- it -- does not dribble half-finished results out to the students.
CREATE TABLE IF NOT EXISTS semester_settings (
  semester             VARCHAR(32) PRIMARY KEY,
  results_published_at TIMESTAMPTZ,
  published_by         UUID REFERENCES admins(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit of every batch run, so re-runs and their outcomes are traceable.
CREATE TABLE IF NOT EXISTS allotment_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semester     VARCHAR(32) NOT NULL,
  triggered_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       VARCHAR(20) NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'succeeded', 'failed')),
  summary      JSONB,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS allotment_runs_semester_idx
  ON allotment_runs (semester, started_at DESC);

-- ---------------------------------------------------------------------------
-- Swaps (schema landed in Phase 1; the approval UI is Phase 2)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS swap_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_a_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  group_b_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  semester     VARCHAR(32) NOT NULL,
  reason       TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at  TIMESTAMPTZ,
  approved_by  UUID REFERENCES admins(id) ON DELETE SET NULL,
  CHECK (group_a_id <> group_b_id)
);

-- Append-only audit trail for anything that moves a group between rooms.
CREATE TABLE IF NOT EXISTS swap_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_request_id UUID REFERENCES swap_requests(id) ON DELETE SET NULL,
  actor_admin_id  UUID REFERENCES admins(id) ON DELETE SET NULL,
  action          VARCHAR(40) NOT NULL,
  details         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
