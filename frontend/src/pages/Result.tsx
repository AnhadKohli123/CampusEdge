import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorBanner, Spinner, StatusPill } from '../components/Feedback';
import { Stepper } from '../components/Stepper';
import { BuildingIcon, ClockIcon, KeyIcon, UsersIcon } from '../components/Icons';
import type { Allotment, Group } from '../lib/types';

type MineResponse = {
  semester: string;
  resultsPublished: boolean;
  /** `status` is withheld by the API until results are published. */
  group:
    | (Pick<Group, 'id' | 'avg_cgpa'> & { name: string | null; status?: Group['status'] })
    | null;
  allotment: Allotment | null;
  preferenceCount?: number;
  message: string;
};

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 font-medium text-ink-100">{value}</dd>
    </div>
  );
}

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

  if (loading) return <Spinner label="Checking your allotment…" />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <Stepper
        current={2}
        steps={[
          { to: '/group', label: 'Form group', done: Boolean(data.group) },
          {
            to: '/preferences',
            label: 'Rank preferences',
            done: (data.preferenceCount ?? 0) > 0,
          },
          { to: '/result', label: 'Result', done: Boolean(data.allotment) },
        ]}
      />

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-50">
          Allotment result
        </h1>
        <p className="mt-1.5 text-sm text-ink-400">{data.semester}</p>
      </div>

      {!data.group ? (
        <div className="card space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-navy-800 text-ink-400 ring-1 ring-inset ring-navy-700">
            <UsersIcon />
          </div>
          <p className="text-ink-200">{data.message}</p>
          <Link to="/group" className="btn-primary">Form a group</Link>
        </div>
      ) : !data.resultsPublished ? (
        /* Results are not out. Nothing here hints at the outcome -- the API
           does not send it, so there is nothing to accidentally render. */
        <div className="card space-y-6 text-center">
          <div className="relative mx-auto flex h-16 w-16 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-lg bg-accent-500/10" />
            <span className="relative flex h-16 w-16 items-center justify-center rounded-lg bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-500/25">
              <ClockIcon className="h-6 w-6" />
            </span>
          </div>

          <div>
            <h2 className="text-lg font-medium text-ink-50">Results are not out yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-balance text-sm leading-relaxed text-ink-400">
              {data.message}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-4 border-t border-navy-700/70 pt-5 text-left">
            <Detail label="Your group" value={data.group.name ?? 'Unnamed'} />
            <Detail
              label="Preferences submitted"
              value={String(data.preferenceCount ?? 0)}
            />
          </dl>

          {(data.preferenceCount ?? 0) === 0 && (
            <Link to="/preferences" className="btn-primary">Submit preferences</Link>
          )}
        </div>
      ) : data.allotment ? (
        <div className="card overflow-hidden">
          {/* Celebratory band -- this is the one screen that earns it. */}
          <div className="-mx-6 -mt-6 mb-6 bg-gradient-to-br from-accent-600/25 via-accent-500/10 to-transparent px-6 py-7">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent-400 to-accent-600 text-white shadow-glow">
                <KeyIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-ink-300">
                  {data.group.name ?? 'Your group'}
                </p>
                <p className="truncate text-3xl font-semibold tracking-tight text-ink-50">
                  {data.allotment.hostel_name}
                </p>
              </div>
              {data.group.status && (
                <span className="ml-auto shrink-0">
                  <StatusPill status={data.group.status} />
                </span>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Detail label="Room" value={data.allotment.room_number} />
            <Detail label="Type" value={data.allotment.room_type_name} />
            <Detail
              label="Preference"
              value={data.allotment.matched_rank ? `#${data.allotment.matched_rank}` : 'Swap'}
            />
            <Detail
              label="Group CGPA"
              value={data.group.avg_cgpa?.toFixed(2) ?? '—'}
            />
          </dl>

          <p className="mt-6 flex items-center gap-2 border-t border-navy-700/70 pt-5 text-xs text-ink-500">
            <BuildingIcon className="h-3.5 w-3.5" />
            Report to the {data.allotment.hostel_name} caretaker with your ID to collect
            keys.
          </p>
        </div>
      ) : (
        <div className="card space-y-4 text-center">
          {data.group.status && <StatusPill status={data.group.status} />}
          <p className="text-ink-200">{data.message}</p>
          {data.group.status === 'waitlist' && (
            <p className="mx-auto max-w-sm text-balance text-sm leading-relaxed text-ink-400">
              Rooms may free up before the semester starts, and every re-run
              reconsiders the waitlist. A caretaker can place you manually if one does.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
