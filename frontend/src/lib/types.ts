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
