import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api, AuthOut, User } from "./api";

const KEY = "inked_token_v2";
const LEGACY_KEY = "inked_token";

async function readToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      if (typeof window === "undefined") return null;
      const current = window.localStorage.getItem(KEY);
      if (current) return current;
      window.localStorage.removeItem(LEGACY_KEY);
      return null;
    } catch { return null; }
  }
  try {
    const current = await SecureStore.getItemAsync(KEY);
    if (current) return current;
    await SecureStore.deleteItemAsync(LEGACY_KEY);
    return null;
  } catch { return null; }
}

async function writeToken(v: string | null) {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return;
    if (v) window.localStorage.setItem(KEY, v); else window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(LEGACY_KEY);
    return;
  }
  if (v) await SecureStore.setItemAsync(KEY, v); else await SecureStore.deleteItemAsync(KEY);
  await SecureStore.deleteItemAsync(LEGACY_KEY);
}

type Ctx = {
  user: User | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, role?: "customer" | "artist") => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const clearSession = useCallback(async () => {
    await writeToken(null);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    let active = true;
    const onAuthExpired = () => { void clearSession(); };
    if (typeof window !== "undefined") window.addEventListener("tinta:auth-expired", onAuthExpired);
    (async () => {
      const t = await readToken();
      if (!active) return;
      if (t) {
        try {
          const me = await api<User>("/auth/me", {}, t);
          if (!active) return;
          setUser(me); setToken(t);
        } catch { await clearSession(); }
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
      if (typeof window !== "undefined") window.removeEventListener("tinta:auth-expired", onAuthExpired);
    };
  }, [clearSession]);

  const doAuth = useCallback(async (path: string, body: any, persist = true) => {
    const r = await api<AuthOut>(path, { method: "POST", body: JSON.stringify(body) });
    if (!r.access_token) { await clearSession(); return; }
    const me = await api<User>("/auth/me", {}, r.access_token);
    if (persist) {
      await writeToken(r.access_token);
      setToken(r.access_token);
      setUser(me);
    } else {
      await clearSession();
    }
  }, [clearSession]);

  const signIn = useCallback((email: string, password: string) => doAuth("/auth/login", { email, password }), [doAuth]);
  const signUp = useCallback((email: string, password: string, name: string, role: "customer" | "artist" = "customer") => doAuth("/auth/register", { email, password, name }, role !== "artist"), [doAuth]);
  const signOut = useCallback(async () => { await clearSession(); }, [clearSession]);

  return <SessionContext.Provider value={{ user, token, loading, signIn, signUp, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useSession must be used inside SessionProvider");
  return c;
}
