import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  EmptyState,
  ErrorBanner,
  Stat,
  StatusPill,
  TableSkeleton,
} from '../components/Feedback';
import { ListIcon, PlayIcon, UsersIcon } from '../components/Icons';
import type { AdminQueue } from '../lib/types';

type SortKey = 'cgpa' | 'name' | 'members' | 'preferences' | 'status' | 'created';

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'name', label: 'Group' },
  { key: 'cgpa', label: 'Avg CGPA', align: 'right' },
  { key: 'members', label: 'Members', align: 'right' },
  { key: 'preferences', label: 'Prefs', align: 'right' },
  { key: 'status', label: 'Status' },
];

/**
 * The allotment queue. Sorted by CGPA descending by default, which is exactly
 * the order the batch job will process groups in -- so this page doubles as a
 * preview of what the next run will do.
 */
export function AdminGroups() {
  const { session } = useAuth();
  const isAdmin = session?.kind === 'staff' && session.user.role === 'admin';

  const [semester, setSemester] = useState('2024-Spring');
  const [sort, setSort] = useState<SortKey>('cgpa');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [status, setStatus] = useState<'' | 'active' | 'allotted' | 'waitlist'>('');
  const [search, setSearch] = useState('');

  const [data, setData] = useState<AdminQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ semester, sort, order });
      if (status) params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      setData(await api<AdminQueue>(`/admin/groups?${params}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [semester, sort, order, status, search]);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  function toggleSort(key: SortKey) {
    if (sort === key) {
      setOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(key);
      // CGPA and counts are most useful high-to-low; names read better A-Z.
      setOrder(key === 'name' || key === 'created' ? 'asc' : 'desc');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50">
            Allotment queue
          </h1>
          <p className="mt-1.5 text-balance text-sm leading-relaxed text-ink-400">
            Ranked by average CGPA — the order the batch job places groups in.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span
              className={`pill ring-1 ring-inset ${
                data.resultsPublishedAt
                  ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25'
                  : 'bg-navy-700/60 text-ink-300 ring-navy-600'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {data.resultsPublishedAt ? 'Results published' : 'Results hidden'}
            </span>
          )}
          {isAdmin && (
            <Link to="/admin" className="btn-primary">
              <PlayIcon className="h-3.5 w-3.5" />
              Run allotment
            </Link>
          )}
        </div>
      </div>

      <ErrorBanner error={error} />

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Ready to allot"
            value={data.readyToAllot}
            tone="text-accent-300"
            icon={<PlayIcon className="h-3.5 w-3.5" />}
          />
          <Stat
            label="Active"
            value={data.counts.active}
            icon={<UsersIcon className="h-3.5 w-3.5" />}
          />
          <Stat label="Allotted" value={data.counts.allotted} tone="text-emerald-400" />
          <Stat label="Waitlisted" value={data.counts.waitlist} tone="text-amber-300" />
        </div>
      )}

      <section className="card space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            className="input"
            placeholder="Search group, lead name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input sm:w-40"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="allotted">Allotted</option>
            <option value="waitlist">Waitlisted</option>
          </select>
          <input
            className="input sm:w-40"
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            aria-label="Semester"
          />
        </div>

        {loading && !data ? (
          <TableSkeleton rows={6} cols={6} />
        ) : !data || data.groups.length === 0 ? (
          <EmptyState
            icon={<ListIcon />}
            title="No groups match"
            hint="Try clearing the filters or checking the semester."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="table-head">
                <tr>
                  <th className="w-10 py-2.5 pr-2">#</th>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`py-2.5 pr-4 ${col.align === 'right' ? 'text-right' : ''}`}
                    >
                      <button
                        // `uppercase` is repeated here because Tailwind's
                        // preflight resets text-transform on buttons, so the
                        // thead's uppercase does not reach this label.
                        className="inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-ink-200"
                        onClick={() => toggleSort(col.key)}
                      >
                        {col.label}
                        <span
                          className={
                            sort === col.key ? 'text-accent-400' : 'text-transparent'
                          }
                        >
                          {order === 'desc' ? '↓' : '↑'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="py-2.5">Room</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-700/70">
                {data.groups.map((group, index) => {
                  const incomplete = group.member_count !== data.groupSize;
                  const noPrefs = group.preference_count === 0;
                  return (
                    <tr key={group.id} className="row-hover">
                      <td className="py-2.5 pr-2">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${
                            index < 3 && sort === 'cgpa' && order === 'desc'
                              ? 'bg-accent-500/15 text-accent-300'
                              : 'text-ink-600'
                          }`}
                        >
                          {index + 1}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <p className="flex items-center gap-2 font-medium text-ink-100">
                          {group.name ?? 'Unnamed'}
                          {group.gender && (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400 ring-1 ring-inset ring-navy-600">
                              {group.gender === 'female' ? 'Girls' : 'Boys'}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-ink-500">
                          {group.lead_name ?? '—'}
                          {group.lead_email ? ` · ${group.lead_email}` : ''}
                        </p>
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums font-medium text-ink-50">
                        {group.avg_cgpa?.toFixed(2) ?? '—'}
                      </td>
                      <td
                        className={`py-2.5 pr-4 text-right tabular-nums ${
                          incomplete ? 'text-amber-300' : 'text-ink-300'
                        }`}
                        title={incomplete ? 'Incomplete groups are not allotted' : undefined}
                      >
                        {group.member_count}/{data.groupSize}
                      </td>
                      <td
                        className={`py-2.5 pr-4 text-right tabular-nums ${
                          noPrefs ? 'text-amber-300' : 'text-ink-300'
                        }`}
                        title={noPrefs ? 'No preferences submitted yet' : undefined}
                      >
                        {group.preference_count}
                      </td>
                      <td className="py-2.5 pr-4">
                        <StatusPill status={group.status} />
                      </td>
                      <td className="py-2.5 text-ink-300">
                        {group.room_number ? (
                          <span className="tabular-nums">
                            {group.hostel_name} · {group.room_number}
                            {group.matched_rank && (
                              <span className="ml-1.5 text-xs text-ink-500">
                                #{group.matched_rank}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
