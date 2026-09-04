import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorBanner, Spinner } from '../components/Feedback';
import type { AllotmentSummary, Occupancy } from '../lib/types';

/**
 * Admin trigger page. The batch job is deliberately manual -- allotment is not
 * real-time, an admin decides when the window closes and runs it.
 */
export function AdminAllocate() {
  const [semester, setSemester] = useState('2024-Spring');
  const [occupancy, setOccupancy] = useState<Occupancy | null>(null);
  const [summary, setSummary] = useState<AllotmentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);

  const loadOccupancy = useCallback(async (term: string) => {
    setLoading(true);
    try {
      const data = await api<Occupancy>(
        `/admin/occupancy?semester=${encodeURIComponent(term)}`
      );
      setOccupancy(data);
      setSemester(data.semester);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOccupancy(semester);
    // Only on mount -- the semester field reloads explicitly via the button.
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
      <div>
        <h1 className="text-2xl font-semibold">Run allotment</h1>
        <p className="mt-1 text-sm text-slate-500">
          Groups are ranked by average CGPA and matched to the highest preference
          still available. Re-running is safe — already-allotted groups keep their room.
        </p>
      </div>

      <ErrorBanner error={error} />

      <section className="card">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
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
          {confirming ? (
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
          )}
        </div>
        {confirming && (
          <p className="mt-3 text-sm text-amber-800">
            This assigns rooms for <strong>{semester}</strong> and cannot be undone from
            this screen.
          </p>
        )}
      </section>

      {summary && (
        <section className="card">
          <h2 className="mb-4 font-medium">Last run</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Allotted" value={summary.allotted} tone="text-green-700" />
            <Stat label="Waitlisted" value={summary.waitlisted} tone="text-amber-700" />
            <Stat label="Incomplete groups" value={summary.skippedIncomplete} />
            <Stat label="Rooms still free" value={summary.roomsStillFree} />
          </div>

          {summary.placements.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Group</th>
                    <th className="py-2 pr-4">Avg CGPA</th>
                    <th className="py-2 pr-4">Hostel</th>
                    <th className="py-2 pr-4">Room</th>
                    <th className="py-2">Pref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.placements.map((p) => (
                    <tr key={p.groupId}>
                      <td className="py-2 pr-4 font-medium">{p.name ?? '—'}</td>
                      <td className="py-2 pr-4 tabular-nums">{p.avgCgpa ?? '—'}</td>
                      <td className="py-2 pr-4">{p.hostel}</td>
                      <td className="py-2 pr-4 tabular-nums">{p.roomNumber}</td>
                      <td className="py-2">#{p.matchedRank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {summary.unplaced.length > 0 && (
            <div className="mt-6 rounded-lg bg-amber-50 p-4">
              <h3 className="text-sm font-medium text-amber-900">Not placed</h3>
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
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

      <section className="card">
        <h2 className="mb-4 font-medium">Occupancy · {occupancy?.semester ?? semester}</h2>
        {loading ? (
          <Spinner />
        ) : !occupancy ? null : (
          <>
            <div className="mb-5 grid grid-cols-3 gap-4">
              <Stat label="Total rooms" value={occupancy.totals.totalRooms} />
              <Stat label="Allotted" value={occupancy.totals.allottedRooms} tone="text-green-700" />
              <Stat label="Maintenance" value={occupancy.totals.maintenanceRooms} tone="text-red-700" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Hostel</th>
                    <th className="py-2 pr-4">Room type</th>
                    <th className="py-2 pr-4">Rooms</th>
                    <th className="py-2 pr-4">Allotted</th>
                    <th className="py-2">Free</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {occupancy.breakdown.map((row) => (
                    <tr key={`${row.hostel}-${row.room_type}`}>
                      <td className="py-2 pr-4">{row.hostel}</td>
                      <td className="py-2 pr-4">{row.room_type}</td>
                      <td className="py-2 pr-4 tabular-nums">{row.total_rooms}</td>
                      <td className="py-2 pr-4 tabular-nums">{row.allotted_rooms}</td>
                      <td className="py-2 tabular-nums">
                        {row.total_rooms - row.allotted_rooms - row.maintenance_rooms}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'text-slate-900',
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
