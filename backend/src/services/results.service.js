import { query } from '../db.js';

/**
 * Result visibility.
 *
 * Allotment and publication are separate steps on purpose. An admin may run the
 * batch several times -- after late registrations, after freeing a room from
 * maintenance -- and students should not see a room appear, change, then change
 * again. Nothing student-facing reveals an outcome until `publish` is called.
 */

export async function isPublished(semester) {
  const { rows } = await query(
    'SELECT results_published_at FROM semester_settings WHERE semester = $1',
    [semester]
  );
  return Boolean(rows[0]?.results_published_at);
}

export async function getSettings(semester) {
  const { rows } = await query(
    `SELECT s.semester, s.results_published_at, s.updated_at,
            a.name AS published_by_name, a.email AS published_by_email
       FROM semester_settings s
       LEFT JOIN admins a ON a.id = s.published_by
      WHERE s.semester = $1`,
    [semester]
  );
  return (
    rows[0] ?? {
      semester,
      results_published_at: null,
      published_by_name: null,
      published_by_email: null,
    }
  );
}

export async function setPublished(semester, adminId, published) {
  const { rows } = await query(
    `INSERT INTO semester_settings (semester, results_published_at, published_by, updated_at)
     VALUES ($1, CASE WHEN $3 THEN now() ELSE NULL END, $2, now())
     ON CONFLICT (semester) DO UPDATE
        SET results_published_at = CASE WHEN $3 THEN now() ELSE NULL END,
            published_by = $2,
            updated_at = now()
     RETURNING semester, results_published_at`,
    [semester, adminId, published]
  );
  return rows[0];
}

/**
 * What a student is allowed to see as their group's status.
 *
 * Before publication, 'allotted' and 'waitlist' both leak the outcome, so they
 * are reported as 'submitted' -- a state that says "we have your preferences,
 * sit tight" without hinting either way.
 */
export function maskStatus(status, published) {
  if (published) return status;
  return status === 'active' ? 'active' : 'submitted';
}
