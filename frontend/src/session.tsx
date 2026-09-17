import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api, AuthOut, User } from "./api";

const KEY = "inked_token_v2";
const LEGACY_KEY = "inked_token";
const WEB_IDLE_MS = 30 * 60 * 1000;

async function readToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      if (typeof window === "undefined") return null;
      const current = window.sessionStorage.getItem(KEY);
      window.localStorage.removeItem(KEY);
      window.localStorage.removeItem(LEGACY_KEY);
      return current;
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
    if (v) window.sessionStorage.setItem(KEY, v); else window.sessionStorage.removeItem(KEY);
    window.localStorage.removeItem(KEY);
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

function isArtistHost() {
  if (typeof window !== "undefined") return window.location.hostname.toLowerCase().includes("tinta-artist");
  return false;
}

function isArtistUser(user: User | null) {
  const account = user as (User & { artist_portal?: boolean; role?: string }) | null;
  return !!account && (account.artist_portal === true || account.role === "artist");
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef<string | null>(null);

  const clearSession = useCallback(async () => {
    await writeToken(null);
    tokenRef.current = null;
    setToken(null);
    setUser(null);
  }, []);

  const revokeServerSession = useCallback(async (t: string | null) => {
    if (!t) return;
    try { await api("/auth/logout", { method: "POST" }, t); } catch { /* already expired/revoked */ }
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
          if (isArtistHost() && !isArtistUser(me)) await clearSession();
          else { tokenRef.current = t; setUser(me); setToken(t); }
        } catch { await clearSession(); }
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
      if (typeof window !== "undefined") window.removeEventListener("tinta:auth-expired", onAuthExpired);
    };
  }, [clearSession]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !token) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const t = tokenRef.current;
        void revokeServerSession(t).finally(() => clearSession());
      }, WEB_IDLE_MS);
    };
    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((name) => window.addEventListener(name, resetIdle, { passive: true }));
    resetIdle();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, resetIdle));
    };
  }, [token, clearSession, revokeServerSession]);

  const doAuth = useCallback(async (path: string, body: any, persist = true) => {
    const r = await api<AuthOut>(path, { method: "POST", body: JSON.stringify(body) });
    if (!r.access_token) { await clearSession(); return; }
    const me = await api<User>("/auth/me", {}, r.access_token);
    if (isArtistHost() && !isArtistUser(me)) {
      await clearSession();
      throw new Error("This account is a customer account. Please use the TINTA customer site, not the Artist Portal.");
    }
    if (persist) {
      await writeToken(r.access_token);
      tokenRef.current = r.access_token;
      setToken(r.access_token);
      setUser(me);
    } else await clearSession();
  }, [clearSession]);

  const signIn = useCallback((email: string, password: string) => doAuth("/auth/login", { email, password }), [doAuth]);
  // Artist signup is admin-verified instead of mailbox-verified while the
  // zero-budget launch has no verified outbound email domain.
  const signUp = useCallback((email: string, password: string, name: string, role: "customer" | "artist" = "customer") => doAuth("/auth/register", { email, password, name, role }, role === "artist" ? true : false), [doAuth]);
  const signOut = useCallback(async () => {
    const t = tokenRef.current;
    await revokeServerSession(t);
    await clearSession();
  }, [clearSession, revokeServerSession]);

  return <SessionContext.Provider value={{ user, token, loading, signIn, signUp, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useSession must be used inside SessionProvider");
  return c;
}
