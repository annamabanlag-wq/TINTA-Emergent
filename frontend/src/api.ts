const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://tinta-backend.onrender.com";
export const API_URL = `${BASE}/api`;

export async function api<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  // Some older callers passed the auth token inside RequestInit as `token` instead
  // of using the third argument. Accept both forms so protected endpoints cannot
  // silently lose the Bearer header.
  const legacyToken = (options as any)?.token as string | null | undefined;
  const authToken = token ?? legacyToken ?? null;
  const { token: _ignoredToken, ...requestOptions } = options as any;

  // Build headers with Headers so a stale Authorization header supplied by an
  // older caller can never override the current session token.
  const headers = new Headers(requestOptions.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  else headers.delete("Authorization");

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...requestOptions,
      headers,
    });
  } catch {
    throw new Error("Could not connect to TINTA. Please check your connection and try again.");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Tell SessionProvider to invalidate the local session immediately. This
    // prevents a rejected JWT from being reused across multiple screens.
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("tinta:auth-expired"));
    }
    throw new Error((data as any)?.detail ?? `HTTP ${res.status}`);
  }
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

export async function uploadImage(uri: string, token: string, filename = "reference.jpg", file?: File): Promise<UploadOut> {
  const form = new FormData();
  // React Native: pass { uri, name, type }
  if (typeof window !== "undefined") {
    let blob: Blob;
    try {
      blob = file ?? await (await fetch(uri)).blob();
    } catch {
      throw new Error("Could not read the selected image. Please choose the receipt again.");
    }
    form.append(
      "file",
      new File([blob], filename, { type: blob.type || "image/jpeg" })
    );
  } else {
    form.append("file", { uri, name: filename, type: "image/jpeg" } as any);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form as any,
    });
  } catch {
    throw new Error("Could not upload the receipt. Please check your connection and try again.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("tinta:auth-expired"));
    }
    const detail = (data as any)?.detail;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail ?? `HTTP ${res.status}`)
    );
  }
  return data as UploadOut;
}
