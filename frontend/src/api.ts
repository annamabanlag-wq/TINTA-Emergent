const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
export const API_URL = `${BASE}/api`;

export async function api<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.detail ?? `HTTP ${res.status}`);
  return data as T;
}

// ------- Types -------
export type User = { id: string; email: string; name: string };
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
  deposit: number;
  status: string;
  payment_status: string;
  checkout_session_id?: string | null;
  payment_intent_id?: string | null;
  created_at: string;
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
  last_message: string;
  last_at: string;
};
export type Message = {
  id: string;
  thread_id: string;
  from_user_id: string;
  from_role: "user" | "artist";
  text: string;
  created_at: string;
};

export type Featured = {
  artist: Artist;
  headline: string;
  story: string;
  deal_ends_at: string;
  discount_pct: number;
};

export type CheckoutSessionOut = {
  checkout_url: string;
  session_id: string;
  mock: boolean;
};

export type VerifyOut = {
  paid: boolean;
  booking_id: string;
  payment_status: string;
  mock?: boolean;
};

export type UploadOut = {
  url: string;
  path: string;
  size: number;
};

export async function uploadImage(uri: string, token: string, filename = "reference.jpg"): Promise<UploadOut> {
  const form = new FormData();
  // React Native: pass { uri, name, type }
  form.append("file", { uri, name: filename, type: "image/jpeg" } as any);
  const res = await fetch(`${API_URL}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form as any,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.detail ?? `HTTP ${res.status}`);
  return data as UploadOut;
}
