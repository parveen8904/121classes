import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// The app tells us where to reach it.
//
// Called on every launch, not once at install: Firebase reissues the token by
// itself — on reinstall, on restore from a backup, sometimes for no reason the
// phone explains — and a student whose token has moved on simply stops
// receiving anything, silently. Re-sending it each launch is what keeps the
// list true.
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Not signed in yet is ordinary — the app registers again after login.
  if (!user) return NextResponse.json({ ok: false, reason: "signed out" }, { status: 401 });

  let body: { token?: string; platform?: string; appVersion?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad request" }, { status: 400 });
  }

  const token = String(body.token ?? "").trim();
  const platform = String(body.platform ?? "").toLowerCase();
  if (!token || !["ios", "android", "web"].includes(platform)) {
    return NextResponse.json({ ok: false, reason: "bad request" }, { status: 400 });
  }

  const svc = createServiceClient();
  // The token is the key, so a phone that changed hands moves to its new owner
  // rather than notifying the person who sold it.
  const { error } = await svc.from("push_devices").upsert(
    {
      token,
      user_id: user.id,
      platform,
      app_version: String(body.appVersion ?? "").slice(0, 20) || null,
      last_seen_at: new Date().toISOString(),
      disabled_at: null,
    },
    { onConflict: "token" },
  );
  if (error) return NextResponse.json({ ok: false }, { status: 500 });

  return NextResponse.json({ ok: true });
}
