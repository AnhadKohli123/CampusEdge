import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { EmptyState, ErrorBanner, Spinner, StatusPill } from '../components/Feedback';
import { InvitePanel } from '../components/InvitePanel';
import type { Group, Student } from '../lib/types';

const GROUP_SIZE = 4;

/**
 * Group formation. Step 1 creates the group, step 2 adds members until it is
 * full. Only the lead can modify it, which mirrors the API's own rule.
 */
export function GroupWizard() {
  const { session } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const [groupName, setGroupName] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Student[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ group: Group | null }>('/groups/mine');
      setGroup(data.group);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced student lookup for the "add member" box.
  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await api<{ students: Student[] }>(
          `/students?search=${encodeURIComponent(search.trim())}&limit=8`
        );
        setResults(data.students);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  async function createGroup(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ group: Group }>('/groups', {
        method: 'POST',
        body: groupName ? { name: groupName } : {},
      });
      setGroup(data.group);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function addMember(studentId: string) {
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ group: Group }>(`/groups/${group.id}/members`, {
        method: 'POST',
        body: { studentId },
      });
      setGroup(data.group);
      setSearch('');
      setResults([]);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(studentId: string) {
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ group: Group }>(
        `/groups/${group.id}/members/${studentId}`,
        { method: 'DELETE' }
      );
      setGroup(data.group);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  const isLead = group?.group_lead_id === session?.user.id;
  const isFull = (group?.members.length ?? 0) >= GROUP_SIZE;
  // Once a room is allotted the roster is frozen -- the API rejects changes too.
  const isLocked = group?.status === 'allotted';

  if (!group) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="mb-1 text-2xl font-semibold">Form your group</h1>
        <p className="mb-6 text-sm text-ink-400">
          Groups must have exactly {GROUP_SIZE} members to be allotted a room.
        </p>
        <form onSubmit={createGroup} className="card space-y-4">
          <ErrorBanner error={error} />
          <div>
            <label className="label" htmlFor="groupName">Group name (optional)</label>
            <input
              id="groupName"
              className="input"
              placeholder="e.g. Team Falcon"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
          <p className="text-xs text-ink-400">
            You become the group lead and can add the other {GROUP_SIZE - 1} members.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{group.name ?? 'Your group'}</h1>
          <p className="mt-1 text-sm text-ink-400">
            {group.semester} · average CGPA{' '}
            <span className="font-medium text-ink-100">
              {group.avg_cgpa?.toFixed(2) ?? '—'}
            </span>
          </p>
        </div>
        <StatusPill status={group.status} />
      </div>

      <div className="flex items-center gap-2">
        {Array.from({ length: GROUP_SIZE }, (_, i) => (
          <span
            key={i}
            className={`h-2 flex-1 rounded-full ${
              i < group.members.length ? 'bg-accent-500' : 'bg-navy-700'
            }`}
          />
        ))}
      </div>

      <ErrorBanner error={error} />

      <section className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">
            Members{' '}
            <span className="text-ink-500">
              {group.members.length}/{GROUP_SIZE}
            </span>
          </h2>
          {isFull && (
            <Link to={isLocked ? '/result' : '/preferences'} className="btn-primary">
              {isLocked ? 'View result →' : 'Set preferences →'}
            </Link>
          )}
        </div>

        <ul className="divide-y divide-navy-700/70">
          {group.members.map((member) => (
            <li key={member.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">
                  {member.name}
                  {member.id === group.group_lead_id && (
                    <span className="ml-2 rounded bg-accent-500/15 px-1.5 py-0.5 text-xs text-accent-300">
                      lead
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-400">{member.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-ink-300">
                  {member.cgpa?.toFixed(2) ?? '—'}
                </span>
                {isLead && !isLocked && member.id !== group.group_lead_id && (
                  <button
                    className="text-xs text-rose-400 hover:underline"
                    disabled={busy}
                    onClick={() => removeMember(member.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        {!isFull && isLead && (
          <div className="mt-5 border-t border-navy-700/70 pt-5">
            <label className="label" htmlFor="search">Add a member</label>
            <input
              id="search"
              className="input"
              placeholder="Search by name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {results.length > 0 && (
              <ul className="mt-2 divide-y divide-navy-700/70 rounded-lg border border-navy-700">
                {results
                  .filter((s) => !group.members.some((m) => m.id === s.id))
                  .map((student) => (
                    <li
                      key={student.id}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <div>
                        <p className="text-sm">{student.name}</p>
                        <p className="text-xs text-ink-400">{student.email}</p>
                      </div>
                      <button
                        className="btn-secondary py-1"
                        disabled={busy}
                        onClick={() => addMember(student.id)}
                      >
                        Add
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {!isFull && !isLead && (
          <p className="mt-4 text-sm text-ink-400">
            Only the group lead can add or remove members.
          </p>
        )}
      </section>

      {isLead && !isFull && !isLocked && (
        <InvitePanel
          groupId={group.id}
          seatsFree={GROUP_SIZE - group.members.length}
          onChanged={() => void load()}
        />
      )}

      {isLocked && (
        <EmptyState
          title="Membership is locked"
          hint="Your group has a room for this semester. Ask a caretaker to arrange a swap."
        />
      )}

      {!isFull && !isLocked && (
        <EmptyState
          title={`${GROUP_SIZE - group.members.length} more member(s) needed`}
          hint={`Groups smaller than ${GROUP_SIZE} are not allotted a room.`}
        />
      )}
    </div>
  );
}

