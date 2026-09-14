import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
    isActive
      ? 'bg-accent-500/15 text-accent-300 ring-1 ring-inset ring-accent-500/25'
      : 'text-ink-400 hover:bg-navy-800 hover:text-ink-100',
  ].join(' ');
}

export function Layout() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  const isStaff = session?.kind === 'staff';
  const isAdmin = isStaff && session.user.role === 'admin';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-navy-700/80 bg-navy-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-400 to-accent-600 text-sm font-bold text-white shadow-glow">
              C
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink-50">
              Campus<span className="text-accent-400">Edge</span>
            </span>
          </Link>

          <nav className="flex flex-1 items-center gap-1">
            {session?.kind === 'student' && (
              <>
                <NavLink to="/group" className={navClass}>My group</NavLink>
                <NavLink to="/preferences" className={navClass}>Preferences</NavLink>
                <NavLink to="/result" className={navClass}>Result</NavLink>
              </>
            )}
            {isStaff && (
              <>
                <NavLink to="/admin/groups" className={navClass}>Queue</NavLink>
                {/* `end` so /admin does not stay highlighted on /admin/groups. */}
                <NavLink to="/admin" end className={navClass}>
                  {isAdmin ? 'Allotment' : 'Occupancy'}
                </NavLink>
              </>
            )}
          </nav>

          {session ? (
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm leading-tight text-ink-100">{session.user.name}</p>
                <p className="text-[11px] uppercase tracking-wide text-ink-500">
                  {session.kind === 'staff' ? session.user.role : 'student'}
                </p>
              </div>
              <button
                className="btn-ghost"
                onClick={() => {
                  signOut();
                  navigate('/login');
                }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn-primary">Sign in</Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
}
