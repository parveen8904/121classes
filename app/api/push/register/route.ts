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
  // A PHONE WITH NO ACCOUNT IS STILL A PHONE.
  //
  // This used to refuse anyone not signed in. Someone downloaded the app,
  // allowed notifications and never registered — the phone asked to hear from
  // us, and we said no and kept nothing. She believed she was subscribed. She
  // was not, and nothing would ever have told her.
  //
  // The token is the key, so when they do sign in, this same row gains its
  // owner rather than becoming a second one.

  let body: { token?: string; platform?: string; appVersion?: string; device?: string };
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
  const row: Record<string, unknown> = {
    token,
    platform,
    app_version: String(body.appVersion ?? "").slice(0, 20) || null,
    device: String(body.device ?? "").slice(0, 60) || null,
    last_seen_at: new Date().toISOString(),
    disabled_at: null,
  };
  // Only written when we KNOW who this is. Sending null on every signed-out
  // launch would erase the owner of a phone that has been signed in for weeks —
  // the app registers on every launch, and a session expires far more often
  // than a phone changes hands.
  if (user?.id) row.user_id = user.id;

  const { error } = await svc.from("push_devices").upsert(row, { onConflict: "token" });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });

  return NextResponse.json({ ok: true });
}
