import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { useSession } from "./session";

type Ctx = {
  ids: Set<string>;
  isFavorite: (artistId: string) => boolean;
  toggle: (artistId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const FavoritesContext = createContext<Ctx | null>(null);

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const { token } = useSession();
  const [ids, setIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!token) { setIds(new Set()); return; }
    try {
      const list = await api<string[]>("/favorites/ids", {}, token);
      setIds(new Set(list));
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = useCallback(async (artistId: string) => {
    if (!token) return;
    // optimistic
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(artistId)) next.delete(artistId); else next.add(artistId);
      return next;
    });
    try {
      await api<{ favorited: boolean }>("/favorites/toggle", {
        method: "POST", body: JSON.stringify({ artist_id: artistId }),
      }, token);
    } catch {
      // revert on error
      refresh();
    }
  }, [token, refresh]);

  const isFavorite = useCallback((artistId: string) => ids.has(artistId), [ids]);

  return (
    <FavoritesContext.Provider value={{ ids, isFavorite, toggle, refresh }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const c = useContext(FavoritesContext);
  if (!c) throw new Error("useFavorites must be used inside FavoritesProvider");
  return c;
}
