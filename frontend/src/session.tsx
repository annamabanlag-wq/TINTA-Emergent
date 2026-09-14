import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api, AuthOut, User } from "./api";

// Version the auth key so a deployment that changed JWT signing/config cannot keep
// replaying an old token. Users get a clean session and a fresh token after deploy.
const KEY = "inked_token_v2";
const LEGACY_KEY = "inked_token";

async function readToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      if (typeof window === "undefined") return null;
      const current = window.localStorage.getItem(KEY);
      if (current) return current;
      // Do not restore the legacy token. It may have been signed by an older
      // backend/JWT secret and is the common source of persistent 401 loops.
      window.localStorage.removeItem(LEGACY_KEY);
      return null;
    } catch {
      return null;
    }
  }

  try {
    const current = await SecureStore.getItemAsync(KEY);
    if (current) return current;
    await SecureStore.deleteItemAsync(LEGACY_KEY);
    return null;
  } catch {
    return null;
  }
}

async function writeToken(v: string | null) {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return;
    if (v) window.localStorage.setItem(KEY, v); else window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(LEGACY_KEY);
    return;
  }
  if (v) await SecureStore.setItemAsync(KEY, v);
  else await SecureStore.deleteItemAsync(KEY);
  await SecureStore.deleteItemAsync(LEGACY_KEY);
}

type Ctx = {
  user: User | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const t = await readToken();
      if (t) {
        try {
          const me = await api<User>("/auth/me", {}, t);
          setUser(me);
          setToken(t);
        } catch {
          // Never keep a token that the current backend rejects. This prevents
          // repeated 401 requests on every screen after a deployment/restart.
          await writeToken(null);
          setUser(null);
          setToken(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const doAuth = useCallback(async (path: string, body: any) => {
    const r = await api<AuthOut>(path, { method: "POST", body: JSON.stringify(body) });
    // Registration now intentionally returns an empty token until the mailbox
    // is verified. Never persist an empty token or create a false authenticated
    // session; the verification screen will handle the next step.
    if (!r.access_token) {
      await writeToken(null);
      setToken(null);
      setUser(null);
      return;
    }
    await writeToken(r.access_token);
    setToken(r.access_token);
    setUser(r.user);
  }, []);

  const signIn = useCallback((email: string, password: string) => doAuth("/auth/login", { email, password }), [doAuth]);
  const signUp = useCallback((email: string, password: string, name: string) => doAuth("/auth/register", { email, password, name }), [doAuth]);
  const signOut = useCallback(async () => {
    await writeToken(null);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, token, loading, signIn, signUp, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useSession must be used inside SessionProvider");
  return c;
}
