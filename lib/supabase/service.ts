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

// Like createServiceClient, but returns null when the env vars are absent —
// used by cached/prerendered pages so a LOCAL build (no .env) doesn't crash.
// On Vercel the envs exist, so pages prerender with real data.
export function tryServiceClient(): ReturnType<typeof createServiceClient> | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createServiceClient();
}
