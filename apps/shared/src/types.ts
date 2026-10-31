export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

export interface Business {
  id: number;
  slug: string;
  name: string;
  category: string;
  description: string;
  address: string;
  phone: string;
  timezone: string;
  cancel_window_hours: number;
  slot_step?: number;
  accent_color: string;
}

export interface Provider {
  id: number;
  name: string;
  title: string;
  color: string;
  role: "owner" | "staff";
  active: boolean;
  service_ids: number[];
  email?: string;
}

export interface Service {
  id: number;
  name: string;
  description: string;
  duration: number;
  price: number;
  buffer_before: number;
  buffer_after: number;
  min_notice: number;
  max_days_ahead: number;
  capacity: number;
  requires_confirmation: boolean;
  active: boolean;
  provider_ids: number[];
}

export interface Slot {
  start: string;
  end?: string;
  provider_ids: number[];
}

export interface Booking {
  id: number;
  uid: string;
  status: BookingStatus;
  start: string;
  end: string;
  price: number;
  notes: string;
  source: string;
  cancellation_reason: string;
  cancelled_by: string;
  service: { id: number; name: string; duration: number };
  provider: { id: number; name: string; color: string };
  customer: { id: number; name: string; phone: string };
  business: { slug: string; name: string };
  created_at: string;
  manage_token?: string;
}

export interface Ticket {
  id: number;
  uid: string;
  number: number;
  name: string;
  status: "waiting" | "called" | "serving" | "done" | "left";
  service: { id: number; name: string };
  provider_id: number | null;
  created_at: string;
  called_at: string | null;
  position: number | null;
  eta_minutes: number | null;
}
