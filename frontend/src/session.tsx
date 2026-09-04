import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api, AuthOut, User } from "./api";

const KEY = "inked_token";

async function readToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null; } catch { return null; }
  }
  return SecureStore.getItemAsync(KEY);
}
async function writeToken(v: string | null) {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return;
    if (v) window.localStorage.setItem(KEY, v); else window.localStorage.removeItem(KEY);
    return;
  }
  if (v) await SecureStore.setItemAsync(KEY, v);
  else await SecureStore.deleteItemAsync(KEY);
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
          await writeToken(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const doAuth = useCallback(async (path: string, body: any) => {
    const r = await api<AuthOut>(path, { method: "POST", body: JSON.stringify(body) });
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
