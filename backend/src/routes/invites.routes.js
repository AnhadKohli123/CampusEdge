import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

/**
 * Group invite links.
 *
 * Two routers: one mounted under a group (the lead manages invites) and one
 * public-ish router keyed by token (the recipient previews and accepts).
 *
 * An invite bound to an email can only be accepted by a student with that
 * email, so the link is safe to send to one person. An unbound invite is a
 * "anyone with the link" share for a group chat.
 */

const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS ?? 7);

const newToken = () => randomBytes(24).toString('base64url');

const inviteUrl = (token) => `${config.appBaseUrl}/join/${token}`;

/** Shape an invite row for the API, never leaking the token of a spent invite. */
function present(row) {
  const state = row.revoked_at
    ? 'revoked'
    : row.accepted_at
      ? 'accepted'
      : new Date(row.expires_at) < new Date()
        ? 'expired'
        : 'pending';
  return {
    id: row.id,
    email: row.email,
    state,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    ...(state === 'pending' ? { token: row.token, url: inviteUrl(row.token) } : {}),
  };
}

async function assertLead(user, groupId) {
  const { rows } = await query(
    'SELECT id, group_lead_id, status, semester FROM groups WHERE id = $1',
    [groupId]
  );
  if (rows.length === 0) throw notFound('Group not found');
  if (user.role !== 'admin' && rows[0].group_lead_id !== user.sub) {
    throw forbidden('Only the group lead can manage invites');
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Mounted at /api/groups/:groupId/invites
// ---------------------------------------------------------------------------

export const groupInviteRouter = Router({ mergeParams: true });

groupInviteRouter.use(requireAuth);

const createSchema = z.object({
  // Optional: leave it out for a shareable "anyone with the link" invite.
  email: z.string().email().toLowerCase().trim().optional(),
});

groupInviteRouter.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { groupId } = req.params;
    const group = await assertLead(req.user, groupId);

    if (group.status === 'allotted') {
      throw conflict('This group is already allotted; membership is locked');
    }

    const { email } = req.body;

    const invite = await withTransaction(async (client) => {
      // Lock the group so the seat count cannot change under us.
      await client.query('SELECT id FROM groups WHERE id = $1 FOR UPDATE', [groupId]);

      const { rows: counts } = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM group_members WHERE group_id = $1)::int AS members,
           (SELECT COUNT(*) FROM group_invites
             WHERE group_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
               AND expires_at > now())::int AS pending`,
        [groupId]
      );
      const { members, pending } = counts[0];

      // Outstanding invites count against capacity, otherwise a lead could send
      // six links for two free seats and the losers hit a confusing error.
      if (members + pending >= config.groupSize) {
        throw conflict(
          `No free seats: ${members} member(s) and ${pending} pending invite(s) for a group of ${config.groupSize}`
        );
      }

      if (email) {
        const { rows: already } = await client.query(
          `SELECT 1 FROM group_members gm
             JOIN students s ON s.id = gm.student_id
            WHERE gm.group_id = $1 AND lower(s.email) = $2`,
          [groupId, email]
        );
        if (already.length > 0) throw conflict('That student is already in this group');

        // Replace any live invite for the same address rather than tripping the
        // partial unique index.
        await client.query(
          `UPDATE group_invites SET revoked_at = now()
            WHERE group_id = $1 AND lower(email) = $2
              AND accepted_at IS NULL AND revoked_at IS NULL`,
          [groupId, email]
        );
      }

      const { rows } = await client.query(
        `INSERT INTO group_invites (group_id, token, email, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)
         RETURNING *`,
        [groupId, newToken(), email ?? null, req.user.sub, String(INVITE_TTL_DAYS)]
      );
      return rows[0];
    });

    res.status(201).json({ invite: present(invite) });
  })
);

groupInviteRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    await assertLead(req.user, req.params.groupId);
    const { rows } = await query(
      'SELECT * FROM group_invites WHERE group_id = $1 ORDER BY created_at DESC',
      [req.params.groupId]
    );
    res.json({ invites: rows.map(present) });
  })
);

groupInviteRouter.delete(
  '/:inviteId',
  asyncHandler(async (req, res) => {
    await assertLead(req.user, req.params.groupId);
    const { rows } = await query(
      `UPDATE group_invites SET revoked_at = now()
        WHERE id = $1 AND group_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING *`,
      [req.params.inviteId, req.params.groupId]
    );
    if (rows.length === 0) throw notFound('No pending invite with that id');
    res.json({ invite: present(rows[0]) });
  })
);

// ---------------------------------------------------------------------------
// Mounted at /api/invites
// ---------------------------------------------------------------------------

export const inviteRouter = Router();

/**
 * Preview an invite before signing in, so the join page can say "Team Falcon
 * invited you" rather than demanding a login for an unknown link.
 */
inviteRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT i.*, g.name AS group_name, g.semester, g.status AS group_status,
              lead.name AS invited_by_name,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id)::int AS member_count
         FROM group_invites i
         JOIN groups g    ON g.id = i.group_id
         JOIN students lead ON lead.id = i.invited_by
        WHERE i.token = $1`,
      [req.params.token]
    );
    if (rows.length === 0) throw notFound('That invite link is not valid');

    const row = rows[0];
    const { state } = present(row);
    res.json({
      invite: {
        state,
        email: row.email,
        groupName: row.group_name,
        semester: row.semester,
        invitedByName: row.invited_by_name,
        memberCount: row.member_count,
        groupSize: config.groupSize,
        groupStatus: row.group_status,
      },
    });
  })
);

inviteRouter.post(
  '/:token/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'student') {
      throw forbidden('Only a student can join a group');
    }

    const groupId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM group_invites WHERE token = $1 FOR UPDATE',
        [req.params.token]
      );
      if (rows.length === 0) throw notFound('That invite link is not valid');
      const invite = rows[0];

      if (invite.revoked_at) throw conflict('That invite has been revoked');
      if (invite.accepted_at) throw conflict('That invite has already been used');
      if (new Date(invite.expires_at) < new Date()) throw conflict('That invite has expired');

      const { rows: studentRows } = await client.query(
        'SELECT id, email, gender FROM students WHERE id = $1',
        [req.user.sub]
      );
      const student = studentRows[0];
      if (!student) throw notFound('Student not found');

      // An email-bound invite is addressed to one person.
      if (invite.email && invite.email.toLowerCase() !== student.email.toLowerCase()) {
        throw forbidden(`This invite was sent to ${invite.email}`);
      }

      const { rows: groupRows } = await client.query(
        'SELECT id, status, semester, gender FROM groups WHERE id = $1 FOR UPDATE',
        [invite.group_id]
      );
      const group = groupRows[0];
      if (!group) throw notFound('Group not found');
      if (group.status === 'allotted') {
        throw conflict('That group is already allotted; membership is locked');
      }

      // Hostels are single-gender, so a mixed group could not be placed.
      if (!student.gender) {
        throw badRequest('Set your gender on your profile before joining a group');
      }
      if (group.gender && student.gender !== group.gender) {
        throw forbidden(
          `This is a ${group.gender === 'male' ? "boys'" : "girls'"} group; ` +
            'hostels are single-gender so groups cannot be mixed'
        );
      }

      const { rows: counts } = await client.query(
        'SELECT COUNT(*)::int AS n FROM group_members WHERE group_id = $1',
        [group.id]
      );
      if (counts[0].n >= config.groupSize) {
        throw conflict(`That group is already full (${config.groupSize} members)`);
      }

      // The unique index on (student_id, semester) is the real guard here; this
      // check just turns it into a readable message.
      const { rows: existing } = await client.query(
        `SELECT g.name FROM group_members gm
           JOIN groups g ON g.id = gm.group_id
          WHERE gm.student_id = $1 AND g.semester = $2`,
        [student.id, group.semester]
      );
      if (existing.length > 0) {
        throw badRequest(
          `You are already in a group for ${group.semester}${
            existing[0].name ? ` (${existing[0].name})` : ''
          }. Leave it before joining another.`
        );
      }

      await client.query(
        'INSERT INTO group_members (group_id, student_id) VALUES ($1, $2)',
        [group.id, student.id]
      );
      await client.query(
        'UPDATE group_invites SET accepted_at = now(), accepted_by = $2 WHERE id = $1',
        [invite.id, student.id]
      );
      await client.query(
        `UPDATE groups g SET avg_cgpa = sub.avg
           FROM (SELECT ROUND(AVG(s.cgpa), 2) AS avg
                   FROM group_members gm JOIN students s ON s.id = gm.student_id
                  WHERE gm.group_id = $1) sub
          WHERE g.id = $1`,
        [group.id]
      );

      return group.id;
    });

    res.json({ groupId });
  })
);
