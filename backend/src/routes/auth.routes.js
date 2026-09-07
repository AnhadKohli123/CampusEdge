import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { validate } from '../middleware/validate.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { conflict, unauthorized } from '../utils/errors.js';

const router = Router();

const signupSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  name: z.string().min(1).max(255).trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  cgpa: z.coerce.number().min(0).max(10),
  // Required: hostel buildings are single-gender, so a student cannot be
  // placed at all without it.
  gender: z.enum(['male', 'female']),
  phone: z.string().max(32).trim().optional(),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

router.post(
  '/student/signup',
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    const { email, name, password, cgpa, gender, phone } = req.body;

    const existing = await query('SELECT id FROM students WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      throw conflict('A student with that email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO students (email, name, password_hash, cgpa, gender, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, name, cgpa, gender, phone, created_at`,
      [email, name, passwordHash, cgpa, gender, phone ?? null]
    );

    const student = rows[0];
    res.status(201).json({
      student,
      token: signToken({ sub: student.id, role: 'student', email: student.email }),
    });
  })
);

router.post(
  '/student/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const { rows } = await query(
      'SELECT id, email, name, cgpa, gender, phone, password_hash FROM students WHERE email = $1',
      [email]
    );
    const student = rows[0];
    // Same error either way, so the endpoint does not leak which emails exist.
    if (!student?.password_hash || !(await bcrypt.compare(password, student.password_hash))) {
      throw unauthorized('Invalid email or password');
    }

    delete student.password_hash;
    res.json({
      student,
      token: signToken({ sub: student.id, role: 'student', email: student.email }),
    });
  })
);

router.post(
  '/admin/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const { rows } = await query(
      'SELECT id, email, name, role, hostel_id, password_hash FROM admins WHERE email = $1',
      [email]
    );
    const admin = rows[0];
    if (!admin?.password_hash || !(await bcrypt.compare(password, admin.password_hash))) {
      throw unauthorized('Invalid email or password');
    }

    delete admin.password_hash;
    res.json({
      admin,
      token: signToken({
        sub: admin.id,
        role: admin.role,
        email: admin.email,
        hostelId: admin.hostel_id,
      }),
    });
  })
);

export default router;
