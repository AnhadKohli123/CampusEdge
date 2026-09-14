import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthLayout } from '../components/AuthLayout';
import { ErrorBanner } from '../components/Feedback';
import { EyeIcon, EyeOffIcon } from '../components/Icons';
import type { Admin, Student } from '../lib/types';

type Mode = 'student' | 'staff';

export function Login() {
  const [mode, setMode] = useState<Mode>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const { signIn } = useAuth();
  const navigate = useNavigate();
  // An invite link sends people here and expects them back afterwards.
  const redirectTo = (useLocation().state as { redirectTo?: string } | null)?.redirectTo;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'student') {
        const data = await api<{ student: Student; token: string }>(
          '/auth/student/login',
          { method: 'POST', body: { email, password } }
        );
        signIn({ kind: 'student', user: data.student }, data.token);
        navigate(redirectTo ?? '/group');
      } else {
        const data = await api<{ admin: Admin; token: string }>('/auth/admin/login', {
          method: 'POST',
          body: { email, password },
        });
        signIn({ kind: 'staff', user: data.admin }, data.token);
        navigate(redirectTo ?? '/admin/groups');
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to manage your group and see your allotment."
      footer={
        mode === 'student' ? (
          <>
            New here?{' '}
            <Link
              to="/signup"
              state={redirectTo ? { redirectTo } : undefined}
              className="font-medium text-accent-400 transition-colors hover:text-accent-300"
            >
              Create an account
            </Link>
          </>
        ) : null
      }
    >
      <div className="segment mb-5">
        {(['student', 'staff'] as Mode[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            className={`segment-item capitalize ${
              mode === option ? 'segment-item-active' : ''
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <ErrorBanner error={error} />

        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="input"
            placeholder={
              mode === 'student' ? 'you@campusedge.edu' : 'admin@campusedge.edu'
            }
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="password">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              className="input pr-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
        </div>

        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
