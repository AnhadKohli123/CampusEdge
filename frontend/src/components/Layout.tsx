import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  CloseIcon,
  KeyIcon,
  ListIcon,
  LogOutIcon,
  MenuIcon,
  PlayIcon,
  UsersIcon,
} from './Icons';

type NavItem = { to: string; label: string; icon: React.ReactNode; end?: boolean };

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150',
    isActive
      ? 'bg-accent-500/15 text-accent-300 ring-1 ring-inset ring-accent-500/25'
      : 'text-ink-400 hover:bg-navy-800/80 hover:text-ink-100',
  ].join(' ');
}

export function Layout() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isStaff = session?.kind === 'staff';
  const isAdmin = isStaff && session.user.role === 'admin';

  const items: NavItem[] =
    session?.kind === 'student'
      ? [
          { to: '/group', label: 'My group', icon: <UsersIcon /> },
          { to: '/preferences', label: 'Preferences', icon: <ListIcon /> },
          { to: '/result', label: 'Result', icon: <KeyIcon /> },
        ]
      : isStaff
        ? [
            { to: '/admin/groups', label: 'Queue', icon: <ListIcon /> },
            {
              to: '/admin',
              label: isAdmin ? 'Allotment' : 'Occupancy',
              icon: <PlayIcon />,
              // `end` so /admin does not stay highlighted on /admin/groups.
              end: true,
            },
          ]
        : [];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-navy-700/60 bg-navy-950/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-400 to-accent-600 text-sm font-bold text-white shadow-glow">
              C
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink-50">
              Campus<span className="text-accent-400">Edge</span>
            </span>
          </Link>

          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-3 sm:flex-none">
            {session ? (
              <>
                <div className="hidden text-right sm:block">
                  <p className="text-sm leading-tight text-ink-100">
                    {session.user.name}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.08em] text-ink-500">
                    {session.kind === 'staff' ? session.user.role : 'student'}
                  </p>
                </div>
                <button
                  className="btn-ghost hidden sm:inline-flex"
                  onClick={() => {
                    signOut();
                    navigate('/login');
                  }}
                  aria-label="Sign out"
                >
                  <LogOutIcon />
                </button>
                <button
                  className="btn-ghost sm:hidden"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                  aria-expanded={menuOpen}
                >
                  {menuOpen ? <MenuIcon /> : <MenuIcon />}
                </button>
              </>
            ) : (
              location.pathname !== '/login' && (
                <Link to="/login" className="btn-primary btn-sm">Sign in</Link>
              )
            )}
          </div>
        </div>

        {/* Mobile drawer */}
        {menuOpen && session && (
          <div className="animate-fade-in border-t border-navy-700/60 px-4 py-3 sm:hidden">
            <nav className="flex flex-col gap-1">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={navClass}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
              <button
                className="mt-1 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-400 hover:bg-navy-800 hover:text-ink-100"
                onClick={() => {
                  setMenuOpen(false);
                  signOut();
                  navigate('/login');
                }}
              >
                <CloseIcon />
                Sign out
              </button>
            </nav>
          </div>
        )}
      </header>

      {/* Keyed on the path so React remounts it per route and the entrance
          animation replays -- navigation reads as movement, not a swap. */}
      <main
        key={location.pathname}
        className="mx-auto max-w-6xl animate-fade-up px-4 py-8 sm:py-10"
      >
        <Outlet />
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4">
        <div className="divider mb-4" />
        <p className="text-center text-xs text-ink-600">
          CampusEdge · hostel allotment
        </p>
      </footer>
    </div>
  );
}
