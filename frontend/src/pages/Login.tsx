import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBanner } from '../components/Feedback';
import type { Admin, Student } from '../lib/types';

type Mode = 'student' | 'staff';

export function Login() {
  const [mode, setMode] = useState<Mode>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const { signIn } = useAuth();
  const navigate = useNavigate();

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
        navigate('/group');
      } else {
        const data = await api<{ admin: Admin; token: string }>('/auth/admin/login', {
          method: 'POST',
          body: { email, password },
        });
        signIn({ kind: 'staff', user: data.admin }, data.token);
        navigate('/admin');
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-slate-500">
        Hostel allotment for the current semester.
      </p>

      <div className="mb-4 inline-flex rounded-lg border border-slate-300 bg-white p-1">
        {(['student', 'staff'] as Mode[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMode(option)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize ${
              mode === option ? 'bg-brand-600 text-white' : 'text-slate-600'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <ErrorBanner error={error} />
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {mode === 'student' && (
        <p className="mt-4 text-center text-sm text-slate-500">
          New here?{' '}
          <Link to="/signup" className="font-medium text-brand-600 hover:underline">
            Create an account
          </Link>
        </p>
      )}
    </div>
  );
}
