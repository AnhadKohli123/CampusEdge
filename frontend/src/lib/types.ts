export type Student = {
  id: string;
  email: string;
  name: string;
  cgpa: number | null;
  phone?: string | null;
};

export type Admin = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'caretaker';
  hostel_id: string | null;
};

export type Hostel = { id: string; name: string; building_code: string };
export type RoomType = { id: string; name: string; capacity: number };

export type Group = {
  id: string;
  name: string | null;
  group_lead_id: string;
  avg_cgpa: number | null;
  status: 'active' | 'allotted' | 'waitlist';
  semester: string;
  members: Pick<Student, 'id' | 'name' | 'email' | 'cgpa'>[];
};

export type Preference = {
  id: string;
  rank: number;
  hostel_id: string;
  hostel_name: string;
  room_type_id: string;
  room_type_name: string;
  capacity: number;
};

export type Allotment = {
  id: string;
  semester: string;
  matched_rank: number | null;
  allotted_at: string;
  group_id: string;
  group_name: string | null;
  avg_cgpa: number | null;
  room_number: string;
  hostel_name: string;
  building_code: string;
  room_type_name: string;
  capacity: number;
};

export type AllotmentSummary = {
  runId: string;
  semester: string;
  groupSize: number;
  consideredGroups: number;
  allotted: number;
  waitlisted: number;
  skippedIncomplete: number;
  roomsStillFree: number;
  byPreferenceRank: Record<string, number>;
  placements: {
    groupId: string;
    name: string | null;
    avgCgpa: number | null;
    matchedRank: number;
    hostel: string;
    roomType: string;
    roomNumber: string;
  }[];
  unplaced: { groupId: string; name: string | null; reason: string }[];
};

export type Occupancy = {
  semester: string;
  /** Set when a caretaker is seeing only their own hostel. */
  scopedToHostel?: string | null;
  totals: { totalRooms: number; allottedRooms: number; maintenanceRooms: number };
  breakdown: {
    hostel: string;
    room_type: string;
    capacity: number;
    total_rooms: number;
    allotted_rooms: number;
    maintenance_rooms: number;
  }[];
};

export type Invite = {
  id: string;
  email: string | null;
  state: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  /** Only present while the invite is still pending. */
  token?: string;
  url?: string;
};

export type InvitePreview = {
  state: Invite['state'];
  email: string | null;
  groupName: string | null;
  semester: string;
  invitedByName: string;
  memberCount: number;
  groupSize: number;
  groupStatus: Group['status'];
};

export type AdminGroupRow = {
  id: string;
  name: string | null;
  status: Group['status'];
  avg_cgpa: number | null;
  member_count: number;
  preference_count: number;
  lead_name: string | null;
  lead_email: string | null;
  hostel_name: string | null;
  room_number: string | null;
  matched_rank: number | null;
  created_at: string;
};

export type AdminQueue = {
  semester: string;
  groups: AdminGroupRow[];
  counts: { active: number; allotted: number; waitlist: number };
  readyToAllot: number;
  groupSize: number;
  sort: string;
  order: 'asc' | 'desc';
};
