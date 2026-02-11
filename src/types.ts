export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  RESEND_API_KEY: string;
  SESSION_SECRET: string;
  LEMONSQUEEZY_WEBHOOK_SECRET: string;
  LEMONSQUEEZY_STORE_URL: string;
  ENVIRONMENT: string;
  APP_URL: string;
}

export interface User {
  id: string;
  email: string;
  plan: string;
  check_limit: number;
  api_key_hash: string | null;
  timezone: string;
  created_at: number;
  updated_at: number;
}

export interface Check {
  id: string;
  user_id: string;
  name: string;
  period: number;
  grace: number;
  status: string;
  last_ping_at: number | null;
  last_alert_at: number | null;
  next_expected_at: number | null;
  alert_count: number;
  ping_count: number;
  created_at: number;
  updated_at: number;
}

export interface Ping {
  id: number;
  check_id: string;
  timestamp: number;
  source_ip: string | null;
  duration: number | null;
  type: string;
}

export interface Channel {
  id: string;
  user_id: string;
  kind: string;
  target: string;
  name: string;
  is_default: number;
  created_at: number;
}

export interface Alert {
  id: number;
  check_id: string;
  channel_id: string | null;
  type: string;
  status: string;
  error: string | null;
  created_at: number;
  sent_at: number | null;
}

export interface CheckConfig {
  id: string;
  period: number;
  grace: number;
  status: string;
  user_id: string;
}
