const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://tinta-backend.onrender.com";
export const API_URL = `${BASE}/api`;

export async function api<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  // Some older callers passed the auth token inside RequestInit as `token` instead
  // of using the third argument. Accept both forms so protected endpoints cannot
  // silently lose the Bearer header.
  const legacyToken = (options as any)?.token as string | null | undefined;
  const authToken = token ?? legacyToken ?? null;
  const { token: _ignoredToken, ...requestOptions } = options as any;

  const res = await fetch(`${API_URL}${path}`, {
    ...requestOptions,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(requestOptions.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.detail ?? `HTTP ${res.status}`);
  return data as T;
}

// ------- Types -------
export type User = { id: string; email: string; name: string; is_admin?: boolean };
export type AuthOut = { access_token: string; token_type: string; user: User };
export type Artist = {
  id: string;
  name: string;
  handle: string;
  city: string;
  studio: string;
  address?: string;
  lat?: number;
  lon?: number;
  styles: string[];
  bio: string;
  bio_tl?: string;
  home_service_available?: boolean;
  home_service_fee?: number;
  rate_per_hour: number;
  avatar: string;
  hero: string;
  portfolio: string[];
  rating: number;
  reviews_count: number;
};
export type Booking = {
  id: string;
  user_id: string;
  artist_id: string;
  artist_name: string;
  artist_avatar: string;
  date: string;
  time_slot: string;
  description: string;
  reference_image?: string | null;
  estimated_hours: number;
  home_service?: boolean;
  service_address?: string | null;
  service_fee?: number;
  deposit: number;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  gcash_review_status?: "pending" | "approved" | "rejected" | string | null;
  gcash_reference_number?: string | null;
  checkout_session_id?: string | null;
  payment_intent_id?: string | null;
  created_at: string;
};

export type Followup = {
  booking_id: string;
  artist_id: string;
  artist_name: string;
  artist_avatar: string;
  date: string;
};
export type Review = {
  id: string;
  artist_id: string;
  user_id: string;
  user_name: string;
  rating: number;
  comment: string;
  created_at: string;
};
export type Thread = {
  id: string;
  artist_id: string;
  artist_name: string;
  artist_avatar: string;
  last_message?: string;
  last_message_at?: string;
  unread_count?: number;
};
