import { Link } from 'react-router-dom';
import { CheckIcon } from './Icons';

/**
 * The three things a student has to do, in order. Shown across the student
 * screens so it is always obvious what is done and what is next.
 */
export type Step = { to: string; label: string; done: boolean };

export function Stepper({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <nav aria-label="Progress" className="mb-8">
      <ol className="flex items-center gap-2 sm:gap-3">
        {steps.map((step, index) => {
          const isCurrent = index === current;
          return (
            <li
              key={step.to}
              className="flex flex-1 items-center gap-2 last:flex-none sm:gap-3"
            >
              <Link to={step.to} className="group flex shrink-0 items-center gap-2.5">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200 ${
                    step.done
                      ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-inset ring-emerald-500/30'
                      : isCurrent
                        ? 'bg-gradient-to-b from-accent-500 to-accent-600 text-white shadow-[0_4px_12px_-4px_rgba(77,141,255,.8)]'
                        : 'bg-navy-800 text-ink-500 ring-1 ring-inset ring-navy-700'
                  }`}
                >
                  {step.done ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span
                  className={`hidden whitespace-nowrap text-sm transition-colors sm:block ${
                    isCurrent
                      ? 'font-medium text-ink-100'
                      : 'text-ink-500 group-hover:text-ink-300'
                  }`}
                >
                  {step.label}
                </span>
              </Link>
              {index < steps.length - 1 && (
                <span
                  className={`h-px flex-1 transition-colors duration-300 ${
                    step.done ? 'bg-emerald-500/30' : 'bg-navy-700'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
