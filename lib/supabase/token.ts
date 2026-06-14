import { createClient } from "@supabase/supabase-js";

// Supabase client authenticated by a Bearer token (used by the desktop app's
// API routes — Electron isn't a browser with cookies, so it sends the token).
// RLS + auth.uid() inside SECURITY DEFINER functions resolve from this token.
export function tokenClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Permissive CORS — these routes are token-authenticated, so origin is not the
// security boundary. Lets the desktop app (file:// / localhost) call them.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};
