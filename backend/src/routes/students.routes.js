import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden, notFound } from '../utils/errors.js';

const router = Router();

const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(255).trim().optional(),
    cgpa: z.coerce.number().min(0).max(10).optional(),
    phone: z.string().max(32).trim().optional(),
    gender: z.enum(['male', 'female']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update');

router.get(
  '/',
  requireAuth,
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { search, limit, offset } = req.query;
    const isStaff = req.user.role === 'admin' || req.user.role === 'caretaker';

    // CGPA drives the whole queue, so the directory only exposes it to staff.
    // A student searching for someone to add needs a name and an email.
    const { rows } = await query(
      `SELECT id, email, name, gender,
              ${isStaff ? 'cgpa' : 'NULL::numeric AS cgpa'}, phone, created_at
         FROM students
        WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
        ORDER BY name ASC
        LIMIT $2 OFFSET $3`,
      [search ?? null, limit, offset]
    );
    res.json({ students: rows, limit, offset });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'SELECT id, email, name, cgpa, gender, phone, created_at FROM students WHERE id = $1',
      [req.user.sub]
    );
    if (rows.length === 0) throw notFound('Student not found');
    res.json({ student: rows[0] });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'SELECT id, email, name, cgpa, gender, phone, created_at FROM students WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) throw notFound('Student not found');
    res.json({ student: rows[0] });
  })
);

router.patch(
  '/:id',
  requireAuth,
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    // A student may edit only their own record; admins may edit anyone.
    const isSelf = req.user.sub === req.params.id;
    const isAdmin = req.user.role === 'admin';
    if (!isSelf && !isAdmin) throw forbidden('You can only update your own profile');

    const { name, cgpa, phone, gender } = req.body;
    const { rows } = await query(
      `UPDATE students
          SET name   = COALESCE($2, name),
              cgpa   = COALESCE($3, cgpa),
              phone  = COALESCE($4, phone),
              gender = COALESCE($5, gender)
        WHERE id = $1
        RETURNING id, email, name, cgpa, gender, phone, created_at`,
      [req.params.id, name ?? null, cgpa ?? null, phone ?? null, gender ?? null]
    );
    if (rows.length === 0) throw notFound('Student not found');
    res.json({ student: rows[0] });
  })
);

export default router;
