import type { ReactNode } from 'react';
import type { ApiError } from '../lib/api';
import { AlertIcon } from './Icons';

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const err = error as ApiError;
  return (
    <div className="flex animate-fade-in items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      <span className="mt-0.5 text-rose-400">
        <AlertIcon />
      </span>
      <div className="min-w-0">
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

/**
 * Skeletons rather than a spinner wherever the shape of the result is known.
 * The page keeps its layout instead of collapsing and snapping back.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-navy-800/60 ${className}`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2.5 py-2">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton
              key={c}
              className={`h-4 ${c === 0 ? 'w-1/3' : 'flex-1'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="animate-fade-in rounded-2xl border border-dashed border-navy-600/80 bg-navy-850/30 px-6 py-12 text-center">
      {icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-navy-800/80 text-ink-400 ring-1 ring-inset ring-navy-700">
          {icon}
        </div>
      )}
      <p className="font-medium text-ink-100">{title}</p>
      {hint && (
        <p className="mx-auto mt-1.5 max-w-sm text-balance text-sm leading-relaxed text-ink-400">
          {hint}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  allotted: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
  accepted: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
  waitlist: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
  active: 'bg-accent-500/15 text-accent-300 ring-accent-500/25',
  pending: 'bg-accent-500/15 text-accent-300 ring-accent-500/25',
  // Deliberately neutral: shown to students before results are published, so it
  // must not read as good or bad news.
  submitted: 'bg-navy-700/60 text-ink-300 ring-navy-600',
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
  icon,
}: {
  label: string;
  value: number | string;
  tone?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-navy-700/70 bg-navy-900/40 px-4 py-3.5 transition-colors hover:border-navy-600">
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{label}</p>
        {icon && <span className="text-ink-600 opacity-50">{icon}</span>}
      </div>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${tone}`}>
        {value}
      </p>
    </div>
  );
}

/** Horizontal segmented meter, e.g. 3 of 4 seats filled. */
export function SeatMeter({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`${filled} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
            i < filled ? 'bg-accent-500' : 'bg-navy-700'
          }`}
        />
      ))}
    </div>
  );
}
