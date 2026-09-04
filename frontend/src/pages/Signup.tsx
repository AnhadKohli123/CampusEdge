import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBanner } from '../components/Feedback';
import type { Student } from '../lib/types';

export function Signup() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    cgpa: '',
    phone: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const { signIn } = useAuth();
  const navigate = useNavigate();

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ student: Student; token: string }>('/auth/student/signup', {
        method: 'POST',
        body: {
          name: form.name,
          email: form.email,
          password: form.password,
          cgpa: Number(form.cgpa),
          ...(form.phone ? { phone: form.phone } : {}),
        },
      });
      signIn({ kind: 'student', user: data.student }, data.token);
      navigate('/group');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-slate-500">
        Your CGPA decides your group&apos;s place in the allotment queue.
      </p>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <ErrorBanner error={error} />
        <div>
          <label className="label" htmlFor="name">Full name</label>
          <input id="name" required className="input" value={form.name} onChange={update('name')} />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" required className="input" value={form.email} onChange={update('email')} />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            className="input"
            value={form.password}
            onChange={update('password')}
          />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="cgpa">CGPA</label>
            <input
              id="cgpa"
              type="number"
              step="0.01"
              min="0"
              max="10"
              required
              className="input"
              value={form.cgpa}
              onChange={update('cgpa')}
            />
          </div>
          <div>
            <label className="label" htmlFor="phone">Phone (optional)</label>
            <input id="phone" className="input" value={form.phone} onChange={update('phone')} />
          </div>
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-500">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
