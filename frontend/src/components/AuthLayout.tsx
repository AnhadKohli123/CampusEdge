import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BuildingIcon, CheckIcon } from './Icons';

/**
 * Split shell for the signed-out screens. The left panel explains what the
 * thing is; the right holds the form. On narrow screens the panel collapses
 * to just the wordmark so the form stays above the fold.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    // Sized rather than pinned to the viewport: main already adds padding, so
    // a full-height grid on top of it pushed the form down and forced a scroll.
    <div className="grid items-center gap-12 py-4 lg:min-h-[560px] lg:grid-cols-2 lg:py-8">
      {/* Brand panel */}
      <aside className="hidden animate-fade-up lg:block">
        <Link to="/" className="inline-flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-gradient-to-br from-accent-400 to-accent-600 text-lg font-bold text-white shadow-glow">
            C
          </span>
          <span className="text-xl font-semibold tracking-tight text-ink-50">
            Campus<span className="text-accent-400">Edge</span>
          </span>
        </Link>

        <h2 className="mt-8 max-w-md text-balance text-3xl font-semibold leading-tight tracking-tight text-ink-50">
          Hostel rooms, allotted fairly.
        </h2>
        <p className="mt-3 max-w-md text-balance leading-relaxed text-ink-400">
          Form a group of four, rank the blocks you want, and let the allotment
          run on group CGPA. No queues, no paperwork.
        </p>

        <ul className="mt-8 space-y-3.5">
          {[
            'Groups ranked by average CGPA, ties first-come-first-served',
            'Invite your group by link — email-bound or shareable',
            'Results stay sealed until the hostel office publishes them',
          ].map((line) => (
            <li key={line} className="flex items-start gap-3 text-sm text-ink-300">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-accent-300 ring-1 ring-inset ring-accent-500/25">
                <CheckIcon className="h-3 w-3" />
              </span>
              {line}
            </li>
          ))}
        </ul>

        <div className="mt-10 flex items-center gap-2 text-xs text-ink-600">
          <BuildingIcon className="h-3.5 w-3.5" />
          4 hostels · 11 room types · separate boys' and girls' blocks
        </div>
      </aside>

      {/* Form panel */}
      <div className="mx-auto w-full max-w-md animate-fade-up">
        {/* No wordmark here -- the header already carries one, and on narrow
            screens the two stacked read as a duplication. */}
        <h1 className="text-2xl font-semibold tracking-tight text-ink-50">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-400">{subtitle}</p>}

        <div className="mt-6">{children}</div>

        {footer && <div className="mt-5 text-center text-sm text-ink-400">{footer}</div>}
      </div>
    </div>
  );
}
