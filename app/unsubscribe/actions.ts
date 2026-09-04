"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { unsubscribeTokenValid } from "@/lib/unsubscribe";
import { redirect } from "next/navigation";

// Stopping is one press, and it is honoured by the one place every message
// passes (isBlocked in lib/notify.ts) — not by the sender that happened to
// send this one. That is the difference between "this list" and "us".
export async function confirmUnsubscribe(formData: FormData) {
  const email = String(formData.get("e") ?? "").trim().toLowerCase();
  const token = String(formData.get("t") ?? "").trim();
  if (!email || !(await unsubscribeTokenValid(email, token))) {
    redirect("/unsubscribe?bad=1");
  }
  await createServiceClient().from("email_blocklist").upsert(
    { channel: "email", email, reason: "Unsubscribed from an email link" },
    { onConflict: "channel,email" },
  );
  redirect(`/unsubscribe?done=1&e=${encodeURIComponent(email)}`);
}

// AND A WAY BACK. Somebody who unsubscribes in irritation and later wants
// their class reminders must not have to write in for them; a door that only
// locks is not a setting, it is a trap.
export async function resubscribe(formData: FormData) {
  const email = String(formData.get("e") ?? "").trim().toLowerCase();
  const token = String(formData.get("t") ?? "").trim();
  if (!email || !(await unsubscribeTokenValid(email, token))) {
    redirect("/unsubscribe?bad=1");
  }
  await createServiceClient().from("email_blocklist")
    .delete().eq("channel", "email").eq("email", email);
  redirect(`/unsubscribe?back=1&e=${encodeURIComponent(email)}`);
}
