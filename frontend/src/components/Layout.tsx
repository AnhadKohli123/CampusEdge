import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
  ].join(' ');
}

export function Layout() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Campus<span className="text-brand-600">Edge</span>
          </Link>

          <nav className="flex flex-1 items-center gap-1">
            {session?.kind === 'student' && (
              <>
                <NavLink to="/group" className={navClass}>
                  My group
                </NavLink>
                <NavLink to="/preferences" className={navClass}>
                  Preferences
                </NavLink>
                <NavLink to="/result" className={navClass}>
                  Result
                </NavLink>
              </>
            )}
            {session?.kind === 'staff' && (
              <NavLink to="/admin" className={navClass}>
                Allotment
              </NavLink>
            )}
          </nav>

          {session ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-500 sm:inline">
                {session.user.name}
              </span>
              <button
                className="btn-secondary"
                onClick={() => {
                  signOut();
                  navigate('/login');
                }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn-primary">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
