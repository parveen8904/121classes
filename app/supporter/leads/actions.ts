"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseDelimited } from "@/lib/delimited";
import { phoneKey, emailKey } from "@/lib/supporterLeads";

// A VENDOR HANDING US NAMES.
//
// One at a time from the form, or a whole file at once. Either way the same
// rules apply, because a vendor pasting a hundred rows should not be able to
// record something the form would have refused.
//
// A name is required and one way to reach them is required. The address is not:
// a vendor taking a name across a counter rarely has one, and refusing the lead
// over it loses the lead, which is the opposite of the point.

async function seller(): Promise<{ id: string } | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await createServiceClient()
    .from("profiles").select("is_supporter, role").eq("id", user.id).maybeSingle();
  if (!data?.is_supporter && data?.role !== "supporter" && data?.role !== "admin") return null;
  return { id: user.id };
}

const clean = (v: FormDataEntryValue | null, max = 200) => String(v ?? "").trim().slice(0, max);

export type PushResult = { ok: boolean; added?: number; skipped?: number; error?: string };

export async function pushOneLead(formData: FormData): Promise<void> {
  const me = await seller();
  if (!me) return;

  const name = clean(formData.get("name"), 120);
  const phone = clean(formData.get("phone"), 20);
  const email = clean(formData.get("email"), 160).toLowerCase();
  if (!name || (!phoneKey(phone) && !email.includes("@"))) return;

  const svc = createServiceClient();
  await svc.from("supporter_pushed_leads").insert({
    supporter_id: me.id,
    name,
    phone: phoneKey(phone) || null,
    email: email.includes("@") ? email : null,
    level: clean(formData.get("level"), 40) || null,
    subject_id: clean(formData.get("subject_id"), 40) || null,
    address: clean(formData.get("address"), 400) || null,
    note: clean(formData.get("note"), 400) || null,
    // The date they actually spoke to the student, which is not the day they
    // got round to typing it in.
    lead_date: clean(formData.get("lead_date"), 10) || new Date().toISOString().slice(0, 10),
    // A duplicate is the same student pushed twice, not a second introduction.
  }).select("id").maybeSingle();

  revalidatePath("/supporter/leads");
}

/**
 * A whole file at once.
 *
 * Column names are read from the header rather than fixed by position, because
 * every vendor's spreadsheet has its columns in a different order and telling
 * them to rearrange it is how a feature goes unused.
 */
export async function pushLeadFile(formData: FormData): Promise<void> {
  const me = await seller();
  if (!me) return;

  const raw = String(formData.get("rows") ?? "");
  if (!raw.trim()) return;

  const rows = parseDelimited(raw);
  if (rows.length < 2) return;

  const head = rows[0].map((h) => h.trim().toLowerCase());
  const at = (...names: string[]) => {
    for (const n of names) {
      const i = head.findIndex((h) => h === n || h.replace(/[^a-z]/g, "") === n.replace(/[^a-z]/g, ""));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iName = at("name", "student name", "student");
  const iPhone = at("phone", "mobile", "contact", "phone number");
  const iEmail = at("email", "email id", "e-mail");
  const iLevel = at("level", "course", "class");
  const iAddr = at("address");
  const iDate = at("date", "lead date");
  const iNote = at("note", "remark", "remarks");

  const svc = createServiceClient();
  const batch: Record<string, unknown>[] = [];
  const seenPhone = new Set<string>(), seenEmail = new Set<string>();

  for (const r of rows.slice(1)) {
    const name = (iName >= 0 ? r[iName] : "")?.trim().slice(0, 120) ?? "";
    const phone = phoneKey(iPhone >= 0 ? r[iPhone] : "");
    const email = emailKey(iEmail >= 0 ? r[iEmail] : "");
    if (!name) continue;
    if (!phone && !email.includes("@")) continue;
    // Within the file itself as well as against the table — a spreadsheet that
    // repeats a row would otherwise fail the whole insert on the unique index.
    if (phone && seenPhone.has(phone)) continue;
    if (email && seenEmail.has(email)) continue;
    if (phone) seenPhone.add(phone);
    if (email) seenEmail.add(email);

    const d = (iDate >= 0 ? r[iDate] : "")?.trim() ?? "";
    batch.push({
      supporter_id: me.id,
      name,
      phone: phone || null,
      email: email.includes("@") ? email : null,
      level: (iLevel >= 0 ? r[iLevel] : "")?.trim().slice(0, 40) || null,
      address: (iAddr >= 0 ? r[iAddr] : "")?.trim().slice(0, 400) || null,
      note: (iNote >= 0 ? r[iNote] : "")?.trim().slice(0, 400) || null,
      lead_date: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10),
    });
  }

  // Row by row, ignoring the ones that clash. One repeated student must not
  // throw away the other ninety-nine names in the file.
  for (const row of batch) {
    await svc.from("supporter_pushed_leads").insert(row).select("id").maybeSingle();
  }
  revalidatePath("/supporter/leads");
}
