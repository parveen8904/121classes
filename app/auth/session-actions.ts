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
  const ua = (await headers()).get("user-agent") || "";
  const kind = deviceKind(ua);
  const token = randomUUID() + randomUUID();
  await supabase.from("device_sessions").upsert(
    { user_id: user.id, device_kind: kind, token, user_agent: ua.slice(0, 300), updated_at: new Date().toISOString() },
    { onConflict: "user_id,device_kind" },
  );
  (await cookies()).set("dsid", token, {
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
  (await cookies()).set(c.name, c.value, { httpOnly: true, sameSite: "lax", secure: true, maxAge: c.maxAge, path: "/" });
}

// Clear the password-reset gate cookie once a NEW password has actually been
// set (see /auth/confirm + middleware). Until this runs, a recovery session can
// only reach the reset page.
export async function clearPasswordResetGate(): Promise<void> {
  (await cookies()).delete("pw_reset");
}

const AUTH_TIMEOUT = Symbol("timeout");
function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | typeof AUTH_TIMEOUT> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<typeof AUTH_TIMEOUT>((res) => setTimeout(() => res(AUTH_TIMEOUT), ms)),
  ]);
}

// EVERYTHING THAT FINISHES A PASSWORD SET/RESET, IN ONE ROUND-TRIP.
//
// The set-password screen used to await three separate server actions in a row
// — markHasPassword, claimDevice, clearPasswordResetGate — and each one
// validated the session over the network with getUser(). Three chances for a
// slow auth call to hang; when one did, the client's await never resolved and
// the button sat on "Saving…" for ever, even though the password had already
// been changed (a refresh then worked). Folded into one action with a single
// getUser and a hard timeout, so the caller always gets a clear ok/failed back
// instead of an unresolved promise.
//
//   1. has_password = true — so the middleware never asks for a password again;
//   2. claim this device (single-session cookie) — best-effort;
//   3. clear the recovery gate cookie — best-effort.
//
// The password itself is what matters, so once has_password is written we report
// success even if the device claim hiccups.
export async function finishPasswordSetup(): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const res = await withTimeout(supabase.auth.getUser(), 6000);
  if (res === AUTH_TIMEOUT) return { ok: false };
  const user = res.data?.user;
  if (!user) return { ok: false };

  try {
    await supabase.from("profiles").update({ has_password: true }).eq("id", user.id);
  } catch {
    return { ok: false };
  }

  // Device claim + gate clearing are best-effort — never block a set password.
  try {
    const ua = (await headers()).get("user-agent") || "";
    const kind = deviceKind(ua);
    const token = randomUUID() + randomUUID();
    await supabase.from("device_sessions").upsert(
      { user_id: user.id, device_kind: kind, token, user_agent: ua.slice(0, 300), updated_at: new Date().toISOString() },
      { onConflict: "user_id,device_kind" },
    );
    (await cookies()).set("dsid", token, {
      httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365, path: "/",
    });
  } catch { /* device tracking is not worth failing a password set for */ }
  try { (await cookies()).delete("pw_reset"); } catch { /* nothing to clear */ }

  return { ok: true };
}
