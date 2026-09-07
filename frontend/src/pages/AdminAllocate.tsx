import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBanner, Spinner, Stat } from '../components/Feedback';
import type { AllotmentSummary, Occupancy } from '../lib/types';

type ResultSettings = {
  semester: string;
  results_published_at: string | null;
  published_by_name: string | null;
};

/**
 * Allotment trigger and occupancy.
 *
 * The batch job is deliberately manual: an admin decides when the preference
 * window closes. Caretakers reach this page too, but only for the occupancy of
 * their own hostel -- the API refuses a college-wide run from a caretaker, so
 * the controls are not shown to them either.
 */
export function AdminAllocate() {
  const { session } = useAuth();
  const isAdmin = session?.kind === 'staff' && session.user.role === 'admin';

  const [semester, setSemester] = useState('2024-Spring');
  const [occupancy, setOccupancy] = useState<Occupancy | null>(null);
  const [summary, setSummary] = useState<AllotmentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [settings, setSettings] = useState<ResultSettings | null>(null);
  const [publishing, setPublishing] = useState(false);

  const loadOccupancy = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const query = `?semester=${encodeURIComponent(term)}`;
      const [occupancyData, settingsData] = await Promise.all([
        api<Occupancy>(`/admin/occupancy${query}`),
        api<{ settings: ResultSettings }>(`/admin/results${query}`),
      ]);
      setOccupancy(occupancyData);
      setSettings(settingsData.settings);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  async function setPublished(published: boolean) {
    setPublishing(true);
    setError(null);
    try {
      const data = await api<{ settings: ResultSettings }>(
        `/admin/results/${published ? 'publish' : 'unpublish'}`,
        { method: 'POST', body: { semester } }
      );
      setSettings(data.settings);
    } catch (err) {
      setError(err);
    } finally {
      setPublishing(false);
    }
  }

  useEffect(() => {
    void loadOccupancy(semester);
    // Mount only; the semester field reloads explicitly via Refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAllotment() {
    setRunning(true);
    setError(null);
    setConfirming(false);
    try {
      const data = await api<{ summary: AllotmentSummary }>('/admin/allocate', {
        method: 'POST',
        body: { semester },
      });
      setSummary(data.summary);
      await loadOccupancy(semester);
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-50">
            {isAdmin ? 'Run allotment' : 'Hostel occupancy'}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-ink-400">
            {isAdmin
              ? 'Groups are ranked by average CGPA and matched to their highest available preference. Re-running is safe — allotted groups keep their room.'
              : 'Occupancy for the hostel you look after. Only an administrator can start a college-wide allotment.'}
          </p>
        </div>
        <Link to="/admin/groups" className="btn-secondary">
          View queue
        </Link>
      </div>

      <ErrorBanner error={error} />

      <section className="card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <label className="label" htmlFor="semester">Semester</label>
            <input
              id="semester"
              className="input"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              placeholder="2024-Spring"
            />
          </div>
          <button className="btn-secondary" onClick={() => loadOccupancy(semester)}>
            Refresh
          </button>

          {isAdmin &&
            (confirming ? (
              <div className="flex gap-2">
                <button className="btn-primary" onClick={runAllotment} disabled={running}>
                  {running ? 'Running…' : 'Yes, run it'}
                </button>
                <button className="btn-secondary" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn-primary"
                onClick={() => setConfirming(true)}
                disabled={running}
              >
                Run allotment
              </button>
            ))}
        </div>

        {confirming && (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
            This assigns rooms for <strong>{semester}</strong> and cannot be undone from
            this screen.
          </p>
        )}
      </section>

      {isAdmin && (
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-medium text-ink-50">Results visibility</h2>
              <p className="mt-1 max-w-lg text-sm text-ink-400">
                {settings?.results_published_at
                  ? `Published ${new Date(settings.results_published_at).toLocaleString()}${
                      settings.published_by_name ? ` by ${settings.published_by_name}` : ''
                    }. Students can see their rooms.`
                  : 'Students cannot see any outcome yet — not their room, not their waitlist place. Run the batch as many times as you need, then publish.'}
              </p>
            </div>

            {settings?.results_published_at ? (
              <button
                className="btn-secondary"
                onClick={() => setPublished(false)}
                disabled={publishing}
              >
                {publishing ? 'Working…' : 'Unpublish'}
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={() => setPublished(true)}
                disabled={publishing}
              >
                {publishing ? 'Publishing…' : 'Publish results'}
              </button>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2 border-t border-navy-700/70 pt-4">
            <span
              className={`h-2 w-2 rounded-full ${
                settings?.results_published_at ? 'bg-emerald-400' : 'bg-ink-500'
              }`}
            />
            <span className="text-sm text-ink-300">
              {settings?.results_published_at ? 'Visible to students' : 'Hidden from students'}
            </span>
          </div>
        </section>
      )}

      {summary && (
        <section className="card space-y-5">
          <h2 className="font-medium text-ink-50">Last run</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Allotted" value={summary.allotted} tone="text-emerald-400" />
            <Stat label="Waitlisted" value={summary.waitlisted} tone="text-amber-300" />
            <Stat label="Incomplete" value={summary.skippedIncomplete} />
            <Stat label="Rooms free" value={summary.roomsStillFree} />
          </div>

          {summary.placements.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="table-head">
                  <tr>
                    <th className="py-2.5 pr-4">Group</th>
                    <th className="py-2.5 pr-4 text-right">Avg CGPA</th>
                    <th className="py-2.5 pr-4">Hostel</th>
                    <th className="py-2.5 pr-4">Room</th>
                    <th className="py-2.5">Pref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-700/70">
                  {summary.placements.map((p) => (
                    <tr key={p.groupId} className="row-hover">
                      <td className="py-2.5 pr-4 font-medium text-ink-100">
                        {p.name ?? '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-ink-200">
                        {p.avgCgpa ?? '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-ink-300">{p.hostel}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-ink-300">
                        {p.roomNumber}
                      </td>
                      <td className="py-2.5 text-ink-400">#{p.matchedRank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {summary.unplaced.length > 0 && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
              <h3 className="text-sm font-medium text-amber-200">Not placed</h3>
              <ul className="mt-2 space-y-1 text-sm text-amber-300/90">
                {summary.unplaced.map((u) => (
                  <li key={u.groupId}>
                    {u.name ?? u.groupId} — {u.reason.replace(/_/g, ' ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="card space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-ink-50">
            Occupancy · {occupancy?.semester ?? semester}
          </h2>
          {occupancy?.scopedToHostel && (
            <span className="pill bg-navy-700/60 text-ink-300 ring-1 ring-inset ring-navy-600">
              your hostel only
            </span>
          )}
        </div>

        {loading ? (
          <Spinner />
        ) : !occupancy ? null : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Total rooms" value={occupancy.totals.totalRooms} />
              <Stat
                label="Allotted"
                value={occupancy.totals.allottedRooms}
                tone="text-emerald-400"
              />
              <Stat
                label="Maintenance"
                value={occupancy.totals.maintenanceRooms}
                tone="text-rose-400"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="table-head">
                  <tr>
                    <th className="py-2.5 pr-4">Hostel</th>
                    <th className="py-2.5 pr-4">Room type</th>
                    <th className="py-2.5 pr-4 text-right">Rooms</th>
                    <th className="py-2.5 pr-4 text-right">Allotted</th>
                    <th className="py-2.5 pr-4 text-right">Free</th>
                    <th className="py-2.5 w-32">Fill</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-700/70">
                  {occupancy.breakdown.map((row) => {
                    const pct = row.total_rooms
                      ? Math.round((row.allotted_rooms / row.total_rooms) * 100)
                      : 0;
                    return (
                      <tr key={`${row.hostel}-${row.room_type}`} className="row-hover">
                        <td className="py-2.5 pr-4 text-ink-200">{row.hostel}</td>
                        <td className="py-2.5 pr-4 text-ink-300">{row.room_type}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-ink-300">
                          {row.total_rooms}
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-ink-100">
                          {row.allotted_rooms}
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-ink-300">
                          {row.total_rooms - row.allotted_rooms - row.maintenance_rooms}
                        </td>
                        <td className="py-2.5">
                          <div
                            className="h-1.5 w-full overflow-hidden rounded-full bg-navy-700"
                            title={`${pct}% allotted`}
                          >
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-accent-500 to-accent-400"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
