import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorBanner, Spinner, StatusPill } from '../components/Feedback';
import type { Allotment, Group } from '../lib/types';

type MineResponse = {
  semester: string;
  resultsPublished: boolean;
  /** `status` is withheld by the API until results are published. */
  group: (Pick<Group, 'id' | 'avg_cgpa'> & {
    name: string | null;
    status?: Group['status'];
  }) | null;
  allotment: Allotment | null;
  preferenceCount?: number;
  message: string;
};

export function Result() {
  const [data, setData] = useState<MineResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<MineResponse>('/allotments/mine')
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-50">Allotment result</h1>
        <p className="mt-1 text-sm text-ink-400">{data.semester}</p>
      </div>

      {!data.group ? (
        <div className="card space-y-4 text-center">
          <p className="text-ink-200">{data.message}</p>
          <Link to="/group" className="btn-primary">Form a group</Link>
        </div>
      ) : !data.resultsPublished ? (
        /* Results are not out. Nothing here hints at the outcome -- the API
           does not send it, so there is nothing to accidentally render. */
        <div className="card space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-500/10 ring-1 ring-inset ring-accent-500/25">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent-400" />
          </div>

          <div>
            <h2 className="text-lg font-medium text-ink-50">Results are not out yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-400">{data.message}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-navy-700/70 pt-5 text-left">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Your group
              </p>
              <p className="mt-1 text-ink-100">{data.group.name ?? 'Unnamed'}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Preferences submitted
              </p>
              <p className="mt-1 tabular-nums text-ink-100">{data.preferenceCount ?? 0}</p>
            </div>
          </div>

          {(data.preferenceCount ?? 0) === 0 && (
            <Link to="/preferences" className="btn-primary">
              Submit preferences
            </Link>
          )}
        </div>
      ) : data.allotment ? (
        <div className="card">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-ink-400">{data.group.name ?? 'Your group'}</p>
              <p className="text-3xl font-semibold tracking-tight text-ink-50">
                {data.allotment.hostel_name}
              </p>
            </div>
            {data.group.status && <StatusPill status={data.group.status} />}
          </div>

          <dl className="grid grid-cols-2 gap-4 border-t border-navy-700/70 pt-5 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink-500">Room</dt>
              <dd className="mt-0.5 font-medium text-ink-100">
                {data.allotment.room_number}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">Type</dt>
              <dd className="mt-0.5 font-medium text-ink-100">
                {data.allotment.room_type_name}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">Preference</dt>
              <dd className="mt-0.5 font-medium text-ink-100">
                {data.allotment.matched_rank ? `#${data.allotment.matched_rank}` : 'Swap'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">Group CGPA</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-ink-100">
                {data.group.avg_cgpa?.toFixed(2) ?? '—'}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="card space-y-4 text-center">
          {data.group.status && <StatusPill status={data.group.status} />}
          <p className="text-ink-200">{data.message}</p>
          {data.group.status === 'waitlist' && (
            <p className="text-sm text-ink-400">
              Rooms may free up before the semester starts. A caretaker can place you
              manually if one does.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
