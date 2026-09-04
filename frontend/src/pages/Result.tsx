import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorBanner, Spinner, StatusPill } from '../components/Feedback';
import type { Allotment, Group } from '../lib/types';

type MineResponse = {
  semester: string;
  group: Pick<Group, 'id' | 'name' | 'status' | 'avg_cgpa'> | null;
  allotment: Allotment | null;
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
        <h1 className="text-2xl font-semibold">Allotment result</h1>
        <p className="mt-1 text-sm text-slate-500">{data.semester}</p>
      </div>

      {!data.group ? (
        <div className="card text-center">
          <p className="text-slate-700">{data.message}</p>
          <Link to="/group" className="btn-primary mt-4">Form a group</Link>
        </div>
      ) : data.allotment ? (
        <div className="card">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">{data.group.name ?? 'Your group'}</p>
              <p className="text-3xl font-semibold tracking-tight">
                {data.allotment.hostel_name}
              </p>
            </div>
            <StatusPill status={data.group.status} />
          </div>

          <dl className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-slate-500">Room</dt>
              <dd className="mt-0.5 font-medium">{data.allotment.room_number}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Type</dt>
              <dd className="mt-0.5 font-medium">{data.allotment.room_type_name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Preference</dt>
              <dd className="mt-0.5 font-medium">
                {data.allotment.matched_rank ? `#${data.allotment.matched_rank}` : 'Swap'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Group CGPA</dt>
              <dd className="mt-0.5 font-medium tabular-nums">
                {data.group.avg_cgpa?.toFixed(2) ?? '—'}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="card space-y-4 text-center">
          <StatusPill status={data.group.status} />
          <p className="text-slate-700">{data.message}</p>
          {data.group.status === 'waitlist' && (
            <p className="text-sm text-slate-500">
              Rooms may free up before the semester starts. A caretaker can place you
              manually if one does.
            </p>
          )}
          {data.group.status === 'active' && (
            <Link to="/preferences" className="btn-secondary">Review preferences</Link>
          )}
        </div>
      )}
    </div>
  );
}
