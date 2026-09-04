import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

const router = Router({ mergeParams: true });

const preferenceSchema = z.object({
  preferences: z
    .array(
      z.object({
        hostelId: z.string().uuid(),
        roomTypeId: z.string().uuid(),
      })
    )
    .min(1, 'Submit at least one preference')
    .max(20),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT p.id, p.rank,
              h.id AS hostel_id, h.name AS hostel_name,
              rt.id AS room_type_id, rt.name AS room_type_name, rt.capacity
         FROM preferences p
         JOIN hostels h     ON h.id = p.hostel_id
         JOIN room_types rt ON rt.id = p.room_type_id
        WHERE p.group_id = $1
        ORDER BY p.rank ASC`,
      [req.params.groupId]
    );
    res.json({ preferences: rows });
  })
);

/**
 * Replace the group's whole preference list. Rank is the array index, so the
 * UI just sends the list in the order the student dragged it into -- there is
 * no way to submit a gap or a duplicate rank.
 */
router.put(
  '/',
  requireAuth,
  validate(preferenceSchema),
  asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const { preferences } = req.body;

    const { rows: groupRows } = await query(
      'SELECT group_lead_id, status FROM groups WHERE id = $1',
      [groupId]
    );
    if (groupRows.length === 0) throw notFound('Group not found');
    const group = groupRows[0];

    if (req.user.role !== 'admin' && group.group_lead_id !== req.user.sub) {
      throw forbidden('Only the group lead can set preferences');
    }
    if (group.status === 'allotted') {
      throw conflict('This group is already allotted; preferences are locked');
    }

    // Reject duplicates up front -- the DB constraint would catch it, but the
    // message here names the offending pair.
    const seen = new Set();
    for (const pref of preferences) {
      const key = `${pref.hostelId}:${pref.roomTypeId}`;
      if (seen.has(key)) {
        throw badRequest('The same hostel and room type is listed twice');
      }
      seen.add(key);
    }

    // A group can only be placed in a room sized exactly for it, so a
    // preference for any other capacity would be silently unmatchable.
    const roomTypeIds = [...new Set(preferences.map((p) => p.roomTypeId))];
    const { rows: types } = await query(
      'SELECT id, name, capacity FROM room_types WHERE id = ANY($1::uuid[])',
      [roomTypeIds]
    );
    if (types.length !== roomTypeIds.length) {
      throw badRequest('One or more room types do not exist');
    }
    const wrongSize = types.filter((t) => t.capacity !== config.groupSize);
    if (wrongSize.length > 0) {
      throw badRequest(
        `Groups of ${config.groupSize} can only request room types with capacity ${config.groupSize}`,
        wrongSize.map((t) => ({ roomType: t.name, capacity: t.capacity }))
      );
    }

    const hostelIds = [...new Set(preferences.map((p) => p.hostelId))];
    const { rows: hostels } = await query(
      'SELECT id FROM hostels WHERE id = ANY($1::uuid[])',
      [hostelIds]
    );
    if (hostels.length !== hostelIds.length) {
      throw badRequest('One or more hostels do not exist');
    }

    await withTransaction(async (client) => {
      await client.query('DELETE FROM preferences WHERE group_id = $1', [groupId]);
      for (const [index, pref] of preferences.entries()) {
        await client.query(
          `INSERT INTO preferences (group_id, rank, hostel_id, room_type_id)
           VALUES ($1, $2, $3, $4)`,
          [groupId, index + 1, pref.hostelId, pref.roomTypeId]
        );
      }
    });

    const { rows } = await query(
      `SELECT p.id, p.rank, h.name AS hostel_name, rt.name AS room_type_name
         FROM preferences p
         JOIN hostels h     ON h.id = p.hostel_id
         JOIN room_types rt ON rt.id = p.room_type_id
        WHERE p.group_id = $1
        ORDER BY p.rank ASC`,
      [groupId]
    );
    res.json({ preferences: rows });
  })
);

export default router;
