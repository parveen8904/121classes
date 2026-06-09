import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client — bypasses RLS. SERVER-ONLY. Never import this
// into a client component. Used for trusted server work like inserting a
// GUEST book order (no auth cookie) after a verified payment.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
