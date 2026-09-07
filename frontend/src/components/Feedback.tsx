import type { ApiError } from '../lib/api';

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const err = error as ApiError;
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      <p className="font-medium">{err.message ?? 'Something went wrong'}</p>
      {err.details && err.details.length > 0 && (
        <ul className="mt-1.5 list-inside list-disc text-rose-300/90">
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
  return (
    <div className="flex items-center justify-center gap-2.5 py-12 text-sm text-ink-400">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-navy-600 border-t-accent-400" />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-navy-600 bg-navy-850/40 px-6 py-12 text-center">
      <p className="font-medium text-ink-100">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-400">{hint}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  allotted: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
  waitlist: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
  active: 'bg-accent-500/15 text-accent-300 ring-accent-500/25',
  // Deliberately neutral: shown to students before results are published, so
  // it must not read as good or bad news.
  submitted: 'bg-navy-700/60 text-ink-300 ring-navy-600',
  pending: 'bg-accent-500/15 text-accent-300 ring-accent-500/25',
  accepted: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
  expired: 'bg-navy-700/60 text-ink-400 ring-navy-600',
  revoked: 'bg-navy-700/60 text-ink-400 ring-navy-600',
};

export function StatusPill({ status }: { status: string }) {
  const tone = TONES[status] ?? 'bg-navy-700/60 text-ink-300 ring-navy-600';
  return (
    <span className={`pill capitalize ring-1 ring-inset ${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

/** Big number + caption, used across the admin screens. */
export function Stat({
  label,
  value,
  tone = 'text-ink-50',
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-navy-700/70 bg-navy-900/50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}
