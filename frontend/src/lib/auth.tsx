import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { tokenStore, userStore } from './api';
import type { Admin, Student } from './types';

type Session =
  | { kind: 'student'; user: Student }
  | { kind: 'staff'; user: Admin }
  | null;

type AuthContextValue = {
  session: Session;
  signIn: (session: NonNullable<Session>, token: string) => void;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Session survives a refresh because both halves live in localStorage.
  const [session, setSession] = useState<Session>(() => userStore.get<Session>());

  const signIn = useCallback((next: NonNullable<Session>, token: string) => {
    tokenStore.set(token);
    userStore.set(next);
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
