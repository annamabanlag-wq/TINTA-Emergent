import { api } from "./api";

// ------- Admin Types -------
export type AdminStats = {
  users: number;
  artists: number;
  bookings: { total: number; paid: number; refunded: number; cancelled: number };
  revenue: { gross: number; commission_earned: number; artist_earnings: number; pending_payouts: number };
  commission_pct: number;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  created_at: string;
  bookings_count: number;
};

export type AdminArtist = {
  id: string;
  name: string;
  handle: string;
  city: string;
  studio: string;
  address?: string;
  styles: string[];
  bio: string;
  bio_tl?: string;
  rate_per_hour: number;
  avatar: string;
  hero: string;
  portfolio: string[];
  home_service_available: boolean;
  home_service_fee: number;
  active?: boolean;
  blocked_dates?: string[];
  rating: number;
  reviews_count: number;
  pending_earnings: number;
  pending_count: number;
  paid_out_total: number;
  bookings_count: number;
};

export type AdminBooking = {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  artist_id: string;
  artist_name: string;
  artist_avatar: string;
  date: string;
  time_slot: string;
  description: string;
  estimated_hours: number;
  home_service?: boolean;
  service_fee?: number;
  deposit: number;
  amount_paid?: number;
  commission_amount?: number;
  artist_earnings?: number;
  status: string;
  payment_status: string;
  payment_method?: string;
  created_at: string;
  paid_at?: string;
  refunded_at?: string;
};

export type CommissionRow = {
  artist_id: string;
  artist_name: string;
  artist_avatar?: string;
  bookings: number;
  gross: number;
  commission: number;
  artist_net: number;
};

export type Payout = {
  id: string;
  artist_id: string;
  artist_name: string;
  amount: number;
  count: number;
  note?: string;
  created_by_name?: string;
  created_at: string;
  status: string;
  booking_ids: string[];
};

// ------- Admin API -------
export const adminApi = {
  stats: (token: string) => api<AdminStats>("/admin/stats", {}, token),
  listUsers: (token: string) => api<AdminUser[]>("/admin/users", {}, token),
  toggleUserAdmin: (userId: string, token: string) =>
    api<{ user_id: string; is_admin: boolean }>(`/admin/users/${userId}/toggle-admin`, { method: "POST" }, token),
  listArtists: (token: string) => api<AdminArtist[]>("/admin/artists", {}, token),
  createArtist: (data: Partial<AdminArtist>, token: string) =>
    api<AdminArtist>("/admin/artists", { method: "POST", body: JSON.stringify(data) }, token),
  updateArtist: (id: string, data: Partial<AdminArtist>, token: string) =>
    api<AdminArtist>(`/admin/artists/${id}`, { method: "PATCH", body: JSON.stringify(data) }, token),
  deleteArtist: (id: string, token: string) =>
    api<{ deleted: boolean; deactivated?: boolean }>(`/admin/artists/${id}`, { method: "DELETE" }, token),
  listBookings: (params: { status?: string; payment_status?: string }, token: string) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.payment_status) qs.set("payment_status", params.payment_status);
    const q = qs.toString();
    return api<AdminBooking[]>(`/admin/bookings${q ? "?" + q : ""}`, {}, token);
  },
  refundBooking: (id: string, token: string) =>
    api<{ refunded: boolean }>(`/admin/bookings/${id}/refund`, { method: "POST" }, token),
  payments: (token: string) => api<AdminBooking[]>("/admin/payments", {}, token),
  commissions: (token: string) => api<CommissionRow[]>("/admin/commissions", {}, token),
  payouts: (token: string) => api<Payout[]>("/admin/payouts", {}, token),
  createPayout: (artist_id: string, note: string, token: string) =>
    api<Payout>("/admin/payouts", { method: "POST", body: JSON.stringify({ artist_id, note }) }, token),
};
