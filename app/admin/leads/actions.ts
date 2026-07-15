"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// Normalise anything that looks like an Indian mobile to its 10 digits.
function toPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return ten.length === 10 && /^[6-9]/.test(ten) ? ten : null;
}

// One row of any CSV/pasted line → {name, phone, email}. Column order doesn't
// matter: the email is found by pattern, the phone by digits, and the name is
// the first remaining non-empty field. Handles quoted CSV cells.
function parseLine(line: string): { name: string | null; phone: string | null; email: string | null } | null {
  const cells = line
    .split(/,|;|\t/)
    .map((c) => c.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
  if (!cells.length) return null;
  let email: string | null = null, phone: string | null = null;
  const rest: string[] = [];
  for (const c of cells) {
    if (!email && EMAIL_RE.test(c)) { email = c.match(EMAIL_RE)![0].toLowerCase(); continue; }
    const p: string | null = !phone ? toPhone(c) : null;
    if (p) { phone = p; continue; }
    rest.push(c);
  }
  if (!phone && !email) return null; // nothing contactable on this line
  const name = rest.find((c) => /[a-z]/i.test(c) && c.length >= 2) ?? null;
  return { name, phone, email };
}

// Import contacts from a CSV file and/or pasted text. Dedupes against existing
// leads AND existing student accounts; matched students are linked, not duplicated.
export async function importLeads(formData: FormData) {
  if (!(await requireAdmin())) return;

  let text = str(formData.get("pasted"));
  const file = formData.get("csv");
  if (file instanceof File && file.size > 0) {
    text = `${text}\n${await file.text()}`;
  }
  if (!text.trim()) redirect("/admin/leads?msg=empty");

  const source = str(formData.get("source")) || "csv";
  const rows = text
    .split(/\r?\n/)
    .map(parseLine)
    .filter(Boolean) as { name: string | null; phone: string | null; email: string | null }[];
  // Skip an obvious header row ("Name, Phone, Email" parses to no contact and is
  // already dropped by parseLine; nothing more needed).

  if (!rows.length) redirect("/admin/leads?msg=none");

  const svc = createServiceClient();

  // Existing contacts, fetched once for dedupe + matching.
  const [{ data: existingLeads }, { data: profs }] = await Promise.all([
    svc.from("leads").select("phone, email"),
    svc.from("profiles").select("id, phone, email"),
  ]);
  const leadPhones = new Set((existingLeads ?? []).map((l) => l.phone).filter(Boolean));
  const leadEmails = new Set((existingLeads ?? []).map((l) => l.email).filter(Boolean));
  const profByPhone = new Map<string, string>();
  const profByEmail = new Map<string, string>();
  for (const p of profs ?? []) {
    const ph = p.phone ? toPhone(String(p.phone)) : null;
    if (ph) profByPhone.set(ph, p.id as string);
    if (p.email) profByEmail.set(String(p.email).toLowerCase(), p.id as string);
  }

  let added = 0, students = 0, dupes = 0;
  const inserts: Record<string, unknown>[] = [];
  const seenThisFile = new Set<string>();
  for (const r of rows) {
    const key = r.phone ?? r.email!;
    if (seenThisFile.has(key)) { dupes++; continue; }
    seenThisFile.add(key);
    if ((r.phone && leadPhones.has(r.phone)) || (r.email && leadEmails.has(r.email))) { dupes++; continue; }
    const matched = (r.phone && profByPhone.get(r.phone)) || (r.email && profByEmail.get(r.email)) || null;
    if (matched) students++;
    inserts.push({ name: r.name, phone: r.phone, email: r.email, source, matched_user_id: matched });
    added++;
  }
  // Insert in chunks (Interakt exports can be thousands of rows).
  for (let i = 0; i < inserts.length; i += 500) {
    await svc.from("leads").insert(inserts.slice(i, i + 500));
  }

  revalidatePath("/admin/leads");
  redirect(`/admin/leads?msg=done&added=${added}&students=${students}&dupes=${dupes}`);
}

export async function deleteLead(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("leads").delete().eq("id", id);
  revalidatePath("/admin/leads");
}

// Add one lead by hand (e.g. a number collected on a call).
export async function addLeadManual(formData: FormData) {
  if (!(await requireAdmin())) return;
  const phone = toPhone(str(formData.get("phone")));
  const email = str(formData.get("email")).trim().toLowerCase() || null;
  if (!phone && !email) redirect("/admin/leads?msg=nocontact");
  const svc = createServiceClient();
  // Same dedupe + student-match as the bulk import.
  const [{ data: dupe }, { data: prof }] = await Promise.all([
    phone
      ? svc.from("leads").select("id").eq("phone", phone).limit(1).maybeSingle()
      : svc.from("leads").select("id").eq("email", email).limit(1).maybeSingle(),
    phone
      ? svc.from("profiles").select("id").like("phone", `%${phone}`).limit(1).maybeSingle()
      : svc.from("profiles").select("id").eq("email", email).limit(1).maybeSingle(),
  ]);
  if (dupe) redirect("/admin/leads?msg=exists");
  await svc.from("leads").insert({
    name: str(formData.get("name")) || null,
    phone,
    email,
    note: str(formData.get("note")) || null,
    source: "manual",
    matched_user_id: prof?.id ?? null,
  });
  revalidatePath("/admin/leads");
  redirect("/admin/leads?msg=added1");
}
