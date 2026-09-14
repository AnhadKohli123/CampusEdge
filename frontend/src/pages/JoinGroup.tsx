import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBanner, Spinner } from '../components/Feedback';
import type { InvitePreview } from '../lib/types';

/**
 * Landing page for an invite link. The preview works signed out, so the page
 * can say who invited you before asking you to log in.
 */
export function JoinGroup() {
  const { token = '' } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ invite: InvitePreview }>(`/invites/${token}`)
      .then((data) => setPreview(data.invite))
      .catch(setError)
      .finally(() => setLoading(false));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api(`/invites/${token}/accept`, { method: 'POST' });
      navigate('/group');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Checking invite…" />;

  if (!preview) {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        <ErrorBanner error={error} />
        <Link to="/" className="btn-secondary">Go to CampusEdge</Link>
      </div>
    );
  }

  const unusable = preview.state !== 'pending';
  const seatsLeft = preview.groupSize - preview.memberCount;

  return (
    <div className="mx-auto max-w-md">
      <div className="card space-y-6 text-center">
        <div>
          <p className="eyebrow">You have been invited to join</p>
          <h1 className="mt-2 text-2xl font-semibold text-ink-50">
            {preview.groupName ?? 'a hostel group'}
          </h1>
          <p className="mt-1.5 text-sm text-ink-400">
            {preview.invitedByName} invited you · {preview.semester}
          </p>
        </div>

        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: preview.groupSize }, (_, i) => (
            <span
              key={i}
              className={`h-2.5 w-8 rounded-full ${
                i < preview.memberCount ? 'bg-accent-500' : 'bg-navy-700'
              }`}
            />
          ))}
        </div>
        <p className="-mt-3 text-sm text-ink-400">
          {preview.memberCount} of {preview.groupSize} members
          {seatsLeft > 0 && ` · ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left`}
        </p>

        <ErrorBanner error={error} />

        {unusable ? (
          <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-4 py-3 text-sm text-ink-300">
            This invite is {preview.state}. Ask the group lead for a new link.
          </p>
        ) : !session ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-300">
              Sign in{preview.email ? ` as ${preview.email}` : ''} to accept.
            </p>
            <div className="flex gap-2">
              <Link
                to="/login"
                state={{ redirectTo: `/join/${token}` }}
                className="btn-primary flex-1"
              >
                Sign in
              </Link>
              <Link
                to="/signup"
                state={{ redirectTo: `/join/${token}` }}
                className="btn-secondary flex-1"
              >
                Create account
              </Link>
            </div>
          </div>
        ) : session.kind !== 'student' ? (
          <p className="text-sm text-ink-300">
            You are signed in as staff. Only a student can join a group.
          </p>
        ) : (
          <button className="btn-primary w-full" onClick={accept} disabled={busy}>
            {busy ? 'Joining…' : 'Join this group'}
          </button>
        )}
      </div>
    </div>
  );
}
