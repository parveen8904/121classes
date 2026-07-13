"use server";

import { randomUUID } from "node:crypto";
import { headers, cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { deviceKind } from "@/lib/device";

// Claim this device as the single active session for its kind (mobile/desktop).
// Called right after every successful login. Overwrites any previous token for
// the same (user, kind), so the older device is signed out on its next request.
export async function claimDevice(): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const ua = headers().get("user-agent") || "";
  const kind = deviceKind(ua);
  const token = randomUUID() + randomUUID();
  await supabase.from("device_sessions").upsert(
    { user_id: user.id, device_kind: kind, token, user_agent: ua.slice(0, 300), updated_at: new Date().toISOString() },
    { onConflict: "user_id,device_kind" },
  );
  cookies().set("dsid", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

// Mark that the user now has a password (so they're never asked to set one again).
export async function markHasPassword(): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("profiles").update({ has_password: true }).eq("id", user.id);
}

// Does the signed-in user still need to set a password? (true = first time)
export async function needsPassword(): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("has_password").eq("id", user.id).maybeSingle();
  return !data?.has_password;
}

// "Remember this device for 30 days" — after a successful admin authenticator
// check, drop a signed cookie so this browser skips the 6-digit code for 30 days.
export async function trustThisDevice(): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { trustedCookie } = await import("@/lib/trustedDevice");
  const c = trustedCookie(user.id);
  cookies().set(c.name, c.value, { httpOnly: true, sameSite: "lax", secure: true, maxAge: c.maxAge, path: "/" });
}
