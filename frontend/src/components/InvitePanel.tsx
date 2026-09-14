import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorBanner, StatusPill } from './Feedback';
import type { Invite } from '../lib/types';

/**
 * Invite links. A lead either sends one to a specific address -- which only
 * that student can accept -- or generates an open link to drop in a group chat.
 */
export function InvitePanel({
  groupId,
  seatsFree,
  onChanged,
}: {
  groupId: string;
  seatsFree: number;
  onChanged: () => void;
}) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ invites: Invite[] }>(`/groups/${groupId}/invites`);
      setInvites(data.invites);
    } catch (err) {
      setError(err);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(withEmail: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${groupId}/invites`, {
        method: 'POST',
        body: withEmail && email ? { email } : {},
      });
      setEmail('');
      await load();
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${groupId}/invites/${id}`, { method: 'DELETE' });
      await load();
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard is blocked outside a secure context; the input below still
      // lets them select the link by hand.
    }
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  }

  const pending = invites.filter((i) => i.state === 'pending');
  const past = invites.filter((i) => i.state !== 'pending');

  return (
    <section className="card space-y-5">
      <div>
        <h2 className="font-medium text-ink-50">Invite by link</h2>
        <p className="mt-1 text-sm text-ink-400">
          {seatsFree > 0
            ? `${seatsFree} seat${seatsFree === 1 ? '' : 's'} left. An emailed invite can
               only be accepted by that address; an open link works for anyone who has it.`
            : 'No seats left — revoke a pending invite to free one.'}
        </p>
      </div>

      <ErrorBanner error={error} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input
          type="email"
          className="input"
          placeholder="classmate@college.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={seatsFree <= 0}
        />
        <button
          className="btn-primary"
          onClick={() => create(true)}
          disabled={busy || !email || seatsFree <= 0}
        >
          Send invite
        </button>
        <button
          className="btn-secondary"
          onClick={() => create(false)}
          disabled={busy || seatsFree <= 0}
        >
          Open link
        </button>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="eyebrow">Pending</p>
          {pending.map((invite) => (
            <div
              key={invite.id}
              className="rounded-xl border border-navy-700 bg-navy-900/60 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-ink-100">
                  {invite.email ?? 'Anyone with the link'}
                </span>
                <div className="flex items-center gap-2">
                  <StatusPill status={invite.state} />
                  <button
                    className="btn-danger px-2.5 py-1 text-xs"
                    onClick={() => revoke(invite.id)}
                    disabled={busy}
                  >
                    Revoke
                  </button>
                </div>
              </div>
              {invite.url && (
                <div className="mt-2.5 flex gap-2">
                  <input
                    readOnly
                    className="input font-mono text-xs"
                    value={invite.url}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    className="btn-secondary shrink-0"
                    onClick={() => copy(invite.url!, invite.id)}
                  >
                    {copied === invite.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div className="space-y-1.5">
          <p className="eyebrow">History</p>
          {past.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between rounded-lg px-1 py-1.5 text-sm"
            >
              <span className="text-ink-400">
                {invite.email ?? 'Open link'}
              </span>
              <StatusPill status={invite.state} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
