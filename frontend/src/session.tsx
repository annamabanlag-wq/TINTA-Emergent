import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api, AuthOut, User } from "./api";

const TOKEN_KEY = "inked_token_v2";
const WEB_IDLE_MS = 30 * 60 * 1000;

async function readToken() {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function writeToken(token: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.sessionStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

async function removeToken() {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

function isArtistHost() {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  return window.location.hostname === "tinta-artist.onrender.com";
}

function isArtistUser(user: any) {
  return user?.artist_portal === true || user?.role === "artist";
}

async function revokeServerSession(token: string | null) {
  if (!token) return;
  try { await api("/auth/logout", { method: "POST" }, token); } catch {}
}

type SessionContextType = {
  user: User | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, role?: "customer" | "artist") => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef<string | null>(null);

  const clearSession = useCallback(async () => {
    await removeToken();
    tokenRef.current = null;
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const t = await readToken();
      if (!t) { if (alive) setLoading(false); return; }
      try {
        const me = await api<User>("/auth/me", {}, t);
        if (isArtistHost() && !isArtistUser(me)) throw new Error("wrong portal");
        if (alive) { tokenRef.current = t; setToken(t); setUser(me); }
      } catch { if (alive) await clearSession(); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
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
  }, [token, clearSession]);

  const doAuth = useCallback(async (path: string, body: any, persist = true) => {
    const r = await api<AuthOut>(path, { method: "POST", body: JSON.stringify(body) });
    if (!r.access_token) { await clearSession(); throw new Error("Authentication failed"); }
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
  // Artist accounts use admin identity/application verification instead of
  // mailbox verification while TINTA is on the zero-budget email setup.
  const signUp = useCallback((email: string, password: string, name: string, role: "customer" | "artist" = "customer") => doAuth("/auth/register", { email, password, name, role }, true), [doAuth]);
  const signOut = useCallback(async () => {
    const t = tokenRef.current;
    await revokeServerSession(t);
    await clearSession();
  }, [clearSession]);

  return <SessionContext.Provider value={{ user, token, loading, signIn, signUp, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const c = useContext(SessionContext);
  if (!c) throw new Error("useSession must be used inside SessionProvider");
  return c;
}
