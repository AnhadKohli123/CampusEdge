import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { GroupWizard } from './pages/GroupWizard';
import { Preferences } from './pages/Preferences';
import { Result } from './pages/Result';
import { JoinGroup } from './pages/JoinGroup';
import { AdminAllocate } from './pages/AdminAllocate';
import { AdminGroups } from './pages/AdminGroups';
import type { ReactNode } from 'react';

function RequireKind({ kind, children }: { kind: 'student' | 'staff'; children: ReactNode }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  if (session.kind !== kind) {
    return <Navigate to={session.kind === 'staff' ? '/admin/groups' : '/group'} replace />;
  }
  return <>{children}</>;
}

function Home() {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={session.kind === 'staff' ? '/admin/groups' : '/group'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        {/* Invite links are readable signed out, so this route is public. */}
        <Route path="/join/:token" element={<JoinGroup />} />

        <Route
          path="/group"
          element={
            <RequireKind kind="student">
              <GroupWizard />
            </RequireKind>
          }
        />
        <Route
          path="/preferences"
          element={
            <RequireKind kind="student">
              <Preferences />
            </RequireKind>
          }
        />
        <Route
          path="/result"
          element={
            <RequireKind kind="student">
              <Result />
            </RequireKind>
          }
        />

        <Route
          path="/admin"
          element={
            <RequireKind kind="staff">
              <AdminAllocate />
            </RequireKind>
          }
        />
        <Route
          path="/admin/groups"
          element={
            <RequireKind kind="staff">
              <AdminGroups />
            </RequireKind>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
