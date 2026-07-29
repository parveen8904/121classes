"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assertArea } from "@/lib/adminAccess";
import { EMAIL_EVENT_MAP, sendTemplate } from "@/lib/emailTemplates";

const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export async function saveEmailTemplate(formData: FormData) {
  await assertArea(null);
  const event = str(formData.get("event"));
  if (!EMAIL_EVENT_MAP.has(event)) redirect("/admin/emails?err=unknown");

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  await createServiceClient().from("email_templates").upsert(
    {
      event,
      subject: str(formData.get("subject")),
      body: String(formData.get("body") ?? "").trim(),
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    },
    { onConflict: "event" },
  );
  revalidatePath("/admin/emails");
  redirect(`/admin/emails?saved=${event}#${event}`);
}

// Back to the wording that ships with the site — the row is removed, not
// blanked, so the default is what is used again.
export async function restoreEmailDefault(formData: FormData) {
  await assertArea(null);
  const event = str(formData.get("event"));
  await createServiceClient().from("email_templates").delete().eq("event", event);
  revalidatePath("/admin/emails");
  redirect(`/admin/emails?restored=${event}#${event}`);
}

// Send the real thing to yourself, filled with the sample details, so you can
// see it in your own inbox before a batch goes out.
export async function sendTestEmail(formData: FormData) {
  await assertArea(null);
  const event = str(formData.get("event"));
  const def = EMAIL_EVENT_MAP.get(event);
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const to = str(formData.get("to")) || user?.email || "";
  if (!def || !to) redirect(`/admin/emails?err=notest#${event}`);

  const ok = await sendTemplate(event, to, {
    ...def.sample,
    // A test must never carry a real one-time login token.
    action_url: "https://caparveensharma.com/login",
    action_label: "Sample button",
  });
  redirect(`/admin/emails?test=${ok ? "sent" : "fail"}&to=${encodeURIComponent(to)}#${event}`);
}
