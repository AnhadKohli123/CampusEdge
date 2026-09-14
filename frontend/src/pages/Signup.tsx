import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorBanner } from '../components/Feedback';
import { EyeIcon, EyeOffIcon } from '../components/Icons';
import type { Gender, Student } from '../lib/types';

export function Signup() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    cgpa: '',
    phone: '',
  });
  const [gender, setGender] = useState<Gender | ''>('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const { signIn } = useAuth();
  const navigate = useNavigate();
  const redirectTo = (useLocation().state as { redirectTo?: string } | null)?.redirectTo;

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
          gender,
          ...(form.phone ? { phone: form.phone } : {}),
        },
      });
      signIn({ kind: 'student', user: data.student }, data.token);
      navigate(redirectTo ?? '/group');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Your CGPA decides your group's place in the allotment queue."
      footer={
        <>
          Already registered?{' '}
          <Link
            to="/login"
            state={redirectTo ? { redirectTo } : undefined}
            className="font-medium text-accent-400 transition-colors hover:text-accent-300"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="card space-y-4">
        <ErrorBanner error={error} />

        <div>
          <label className="label" htmlFor="name">Full name</label>
          <input
            id="name"
            required
            autoComplete="name"
            className="input"
            placeholder="Aarav Sharma"
            value={form.name}
            onChange={update('name')}
          />
        </div>

        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="input"
            placeholder="you@campusedge.edu"
            value={form.email}
            onChange={update('email')}
          />
        </div>

        <div>
          <label className="label" htmlFor="password">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              autoComplete="new-password"
              className="input pr-11"
              value={form.password}
              onChange={update('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-500 transition-colors hover:text-ink-200"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          <p className="hint">At least 8 characters.</p>
        </div>

        <div>
          <span className="label">Hostel block</span>
          <div className="grid grid-cols-2 gap-3">
            {(['male', 'female'] as Gender[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setGender(option)}
                className={`btn ${
                  gender === option
                    ? 'border border-accent-500/40 bg-accent-500/15 text-accent-200'
                    : 'border border-navy-600 bg-navy-800/60 text-ink-300 hover:border-navy-500 hover:bg-navy-700/60'
                }`}
              >
                {option === 'male' ? "Boys' hostel" : "Girls' hostel"}
              </button>
            ))}
          </div>
          <p className="hint">
            Blocks are separate, so this decides which buildings you can be allotted
            and who can be in your group.
          </p>
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
              className="input tabular-nums"
              placeholder="8.40"
              value={form.cgpa}
              onChange={update('cgpa')}
            />
          </div>
          <div>
            <label className="label" htmlFor="phone">Phone</label>
            <input
              id="phone"
              className="input tabular-nums"
              placeholder="Optional"
              value={form.phone}
              onChange={update('phone')}
            />
          </div>
        </div>

        <button className="btn-primary w-full" disabled={busy || !gender}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
