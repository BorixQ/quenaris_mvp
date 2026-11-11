import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, EXPIRED_EVENT, TOKEN_KEY, token as storedToken } from '../lib/api';

interface AuthValue { token: string | null; signedOut: boolean; signIn: (username: string, password: string) => Promise<void>; googleSignIn: (credential: string) => Promise<void>; logout: () => Promise<boolean> }
const Context = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(storedToken);
  const [signedOut, setSignedOut] = useState(false);
  const cache = useQueryClient();
  useEffect(() => {
    localStorage.removeItem(TOKEN_KEY);
    const expired = () => { setToken(null); cache.clear(); };
    window.addEventListener(EXPIRED_EVENT, expired);
    return () => window.removeEventListener(EXPIRED_EVENT, expired);
  }, [cache]);
  const accept = useCallback((value: string) => { cache.clear(); sessionStorage.setItem(TOKEN_KEY, value); setSignedOut(false); setToken(value); }, [cache]);
  const signIn = useCallback(async (username: string, password: string) => {
    const result = await api<{ token: string }>('/auth/token/', { method: 'POST', auth: false, body: JSON.stringify({ username, password }) }); accept(result.token);
  }, [accept]);
  const googleSignIn = useCallback(async (credential: string) => {
    const result = await api<{ token: string }>('/auth/oauth/', { method: 'POST', auth: false, body: JSON.stringify({ credential }) }); accept(result.token);
  }, [accept]);
  const logout = useCallback(async () => {
    let revoked = true;
    try { await api('/auth/logout/', { method: 'POST' }); } catch { revoked = false; }
    finally { sessionStorage.removeItem(TOKEN_KEY); cache.clear(); setSignedOut(true); setToken(null); }
    return revoked;
  }, [cache]);
  return <Context value={{ token, signedOut, signIn, googleSignIn, logout }}>{children}</Context>;
}
export function useAuth() { const value = useContext(Context); if (!value) throw new Error('AuthProvider required'); return value; }
