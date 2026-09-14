import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import {
  EmptyState,
  ErrorBanner,
  SeatMeter,
  Spinner,
  StatusPill,
} from '../components/Feedback';
import { InvitePanel } from '../components/InvitePanel';
import { Stepper } from '../components/Stepper';
import { ArrowRightIcon, TrashIcon, UsersIcon } from '../components/Icons';
import type { Group, Student } from '../lib/types';

const GROUP_SIZE = 4;

/** Two-letter monogram, so a member row reads as a person not a bullet. */
function Avatar({ name, lead }: { name: string; lead?: boolean }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        lead
          ? 'bg-gradient-to-br from-accent-400 to-accent-600 text-white'
          : 'bg-navy-800 text-ink-300 ring-1 ring-inset ring-navy-700'
      }`}
    >
      {initials}
    </span>
  );
}

export function GroupWizard() {
  const { session } = useAuth();
  const toast = useToast();

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

  // Debounced lookup for the "add member" box.
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
      toast('Group created — now invite your members');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function addMember(studentId: string, name: string) {
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
      toast(`${name} added to the group`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(studentId: string, name: string) {
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ group: Group }>(
        `/groups/${group.id}/members/${studentId}`,
        { method: 'DELETE' }
      );
      setGroup(data.group);
      toast(`${name} removed`, 'info');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading your group…" />;

  const isLead = group?.group_lead_id === session?.user.id;
  const isFull = (group?.members.length ?? 0) >= GROUP_SIZE;
  // Frozen once the batch has ranked the group. Students see the masked
  // 'submitted' status until results are published; staff see the real one.
  // Either way anything other than 'active' means the API will reject changes.
  const isLocked = Boolean(group && group.status !== 'active');

  if (!group) {
    return (
      <div className="mx-auto max-w-lg">
        <Stepper
          current={0}
          steps={[
            { to: '/group', label: 'Form group', done: false },
            { to: '/preferences', label: 'Rank preferences', done: false },
            { to: '/result', label: 'Result', done: false },
          ]}
        />
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50">
            Form your group
          </h1>
          <p className="mt-1.5 text-balance text-sm leading-relaxed text-ink-400">
            Groups need exactly {GROUP_SIZE} members to be allotted a room. You will
            be the lead and can invite the other {GROUP_SIZE - 1} by link.
          </p>
        </div>

        <form onSubmit={createGroup} className="card space-y-4">
          <ErrorBanner error={error} />
          <div>
            <label className="label" htmlFor="groupName">Group name</label>
            <input
              id="groupName"
              className="input"
              placeholder="e.g. Team Falcon"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
            <p className="hint">Optional — you can leave it blank.</p>
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Stepper
        current={0}
        steps={[
          { to: '/group', label: 'Form group', done: isFull },
          { to: '/preferences', label: 'Rank preferences', done: isLocked },
          { to: '/result', label: 'Result', done: false },
        ]}
      />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink-50">
            {group.name ?? 'Your group'}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-400">
            <span>{group.semester}</span>
            <span aria-hidden>·</span>
            <span>
              avg CGPA{' '}
              <span className="font-medium tabular-nums text-ink-100">
                {group.avg_cgpa?.toFixed(2) ?? '—'}
              </span>
            </span>
            {group.gender && (
              <>
                <span aria-hidden>·</span>
                <span className="pill bg-navy-800 text-ink-300 ring-1 ring-inset ring-navy-700">
                  {group.gender === 'female' ? "Girls' block" : "Boys' block"}
                </span>
              </>
            )}
          </p>
        </div>
        <StatusPill status={group.status} />
      </div>

      <div className="mb-6">
        <SeatMeter filled={group.members.length} total={GROUP_SIZE} />
      </div>

      <div className="space-y-5">
        <ErrorBanner error={error} />

        <section className="card">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-medium text-ink-50">
              Members{' '}
              <span className="ml-1 tabular-nums text-ink-500">
                {group.members.length}/{GROUP_SIZE}
              </span>
            </h2>
            {isFull && (
              <Link
                to={isLocked ? '/result' : '/preferences'}
                className="btn-primary btn-sm"
              >
                {isLocked ? 'View result' : 'Set preferences'}
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>

          <ul className="divide-y divide-navy-700/60">
            {group.members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-3">
                <Avatar name={member.name} lead={member.id === group.group_lead_id} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-100">
                    <span className="truncate">{member.name}</span>
                    {member.id === group.group_lead_id && (
                      <span className="shrink-0 rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-300">
                        lead
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-500">{member.email}</p>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-ink-300">
                  {member.cgpa?.toFixed(2) ?? '—'}
                </span>
                {isLead && !isLocked && member.id !== group.group_lead_id && (
                  <button
                    className="shrink-0 rounded-lg p-1.5 text-ink-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                    disabled={busy}
                    onClick={() => removeMember(member.id, member.name)}
                    aria-label={`Remove ${member.name}`}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}

            {/* Placeholder rows so the shape of a full group is visible. */}
            {!isLocked &&
              Array.from({ length: GROUP_SIZE - group.members.length }, (_, i) => (
                <li key={`empty-${i}`} className="flex items-center gap-3 py-3 opacity-40">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-navy-600" />
                  <p className="text-sm text-ink-600">Empty seat</p>
                </li>
              ))}
          </ul>

          {!isFull && isLead && (
            <div className="mt-5 border-t border-navy-700/70 pt-5">
              <label className="label" htmlFor="search">Add someone already registered</label>
              <input
                id="search"
                className="input"
                placeholder="Search by name or email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {results.length > 0 && (
                <ul className="mt-2 divide-y divide-navy-700/60 overflow-hidden rounded-xl border border-navy-700">
                  {results
                    // Blocks are single-gender, so a mixed group could not be
                    // placed anywhere -- do not offer people who cannot join.
                    .filter((s) => !group.gender || s.gender === group.gender)
                    .filter((s) => !group.members.some((m) => m.id === s.id))
                    .map((student) => (
                      <li
                        key={student.id}
                        className="flex items-center gap-3 bg-navy-900/40 px-3 py-2.5"
                      >
                        <Avatar name={student.name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-ink-100">{student.name}</p>
                          <p className="truncate text-xs text-ink-500">{student.email}</p>
                        </div>
                        <button
                          className="btn-secondary btn-sm shrink-0"
                          disabled={busy}
                          onClick={() => addMember(student.id, student.name)}
                        >
                          Add
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {search.trim().length >= 2 && results.length === 0 && (
                <p className="hint">
                  Nobody found — send them an invite link below instead.
                </p>
              )}
            </div>
          )}

          {!isFull && !isLead && (
            <p className="mt-4 border-t border-navy-700/70 pt-4 text-sm text-ink-500">
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
            icon={<UsersIcon />}
            title="Group changes are closed"
            hint="Allotment has been run for this semester, so the roster is fixed. Your result appears once the hostel office publishes it."
            action={<Link to="/result" className="btn-secondary">Check result</Link>}
          />
        )}
      </div>
    </div>
  );
}
