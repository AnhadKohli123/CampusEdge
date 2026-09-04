import type { ApiError } from '../lib/api';

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const err = error as ApiError;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-medium">{err.message ?? 'Something went wrong'}</p>
      {err.details && err.details.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-red-700">
          {err.details.map((detail, i) => (
            <li key={i}>
              {detail.field ? `${detail.field}: ` : ''}
              {detail.message ?? JSON.stringify(detail)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">{label}</p>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'allotted'
      ? 'bg-green-100 text-green-800'
      : status === 'waitlist'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-slate-100 text-slate-700';
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tone}`}>
      {status}
    </span>
  );
}
