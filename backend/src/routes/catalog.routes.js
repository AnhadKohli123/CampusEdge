import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound } from '../utils/errors.js';

const router = Router();

const hostelQuerySchema = z.object({
  gender: z.enum(['male', 'female']).optional(),
});

router.get(
  '/hostels',
  validate(hostelQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    // The preference screen passes the group's gender so students are never
    // offered a building they cannot be placed in.
    const { rows } = await query(
      `SELECT id, name, building_code, gender FROM hostels
        WHERE ($1::text IS NULL OR gender = $1)
        ORDER BY name ASC`,
      [req.query.gender ?? null]
    );
    res.json({ hostels: rows });
  })
);

router.get(
  '/room-types',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'SELECT id, name, capacity FROM room_types ORDER BY capacity ASC, name ASC'
    );
    res.json({ roomTypes: rows });
  })
);

const roomsQuerySchema = z.object({
  hostelId: z.string().uuid().optional(),
  roomTypeId: z.string().uuid().optional(),
  status: z.enum(['active', 'maintenance', 'reserved']).optional(),
});

router.get(
  '/rooms',
  validate(roomsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { hostelId, roomTypeId, status } = req.query;
    const { rows } = await query(
      `SELECT r.id, r.room_number, r.status, r.current_occupancy,
              h.id AS hostel_id, h.name AS hostel_name, h.gender AS hostel_gender,
              rt.id AS room_type_id, rt.name AS room_type_name, rt.capacity
         FROM rooms r
         JOIN hostels h     ON h.id = r.hostel_id
         JOIN room_types rt ON rt.id = r.room_type_id
        WHERE ($1::uuid IS NULL OR r.hostel_id = $1)
          AND ($2::uuid IS NULL OR r.room_type_id = $2)
          AND ($3::text IS NULL OR r.status = $3)
        ORDER BY h.name, r.room_number`,
      [hostelId ?? null, roomTypeId ?? null, status ?? null]
    );
    res.json({ rooms: rows });
  })
);

// Maintenance toggle -- a caretaker flagging a room out of service before the
// batch job runs is the whole point of having the status column.
const statusSchema = z.object({
  status: z.enum(['active', 'maintenance', 'reserved']),
});

router.patch(
  '/rooms/:id/status',
  requireRole('admin', 'caretaker'),
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    // A caretaker looks after one hostel; they cannot flag rooms in another.
    if (req.user.role === 'caretaker') {
      const { rows: owner } = await query('SELECT hostel_id FROM rooms WHERE id = $1', [
        req.params.id,
      ]);
      if (owner.length === 0) throw notFound('Room not found');
      if (owner[0].hostel_id !== req.user.hostelId) {
        throw forbidden('You can only change rooms in your own hostel');
      }
    }

    const { rows } = await query(
      `UPDATE rooms SET status = $2 WHERE id = $1
       RETURNING id, room_number, status, current_occupancy`,
      [req.params.id, req.body.status]
    );
    if (rows.length === 0) throw notFound('Room not found');
    res.json({ room: rows[0] });
  })
);

export default router;
