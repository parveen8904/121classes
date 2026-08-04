import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

// Keep private conversations out of the database.
//
// Coexistence puts CA Parveen Sharma's own number on the API while it stays on
// his phone — which means EVERY message on it reaches this webhook: students,
// family, business, all of it. Storing the lot would put his private life in a
// table, and no feature here is worth that.
//
// So on his personal number, a message is only recorded if the sender is
// already known to the site — a student or a lead. Everyone else passes
// through untouched: nothing stored, no auto-reply, no draft. He answers those
// on his phone exactly as he does today, and the site never sees them.
//
// The business number (9810079162) is unaffected: it is a business line and
// everything on it is recorded as before.

/** Is this the number that also lives on his phone? */
export async function isPersonalLine(phoneNumberId: string | null | undefined): Promise<boolean> {
  if (!phoneNumberId) return false;
  const personal = (await getSecret("WHATSAPP_PERSONAL_PHONE_ID")).trim();
  return Boolean(personal) && personal === String(phoneNumberId).trim();
}

/** Last ten digits, so 919810012345 and 9810012345 match. */
function tail(phone: string): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * Is this sender someone the site already knows — a student or a lead?
 * Only their messages are recorded on the personal line.
 */
export async function isKnownContact(from: string): Promise<boolean> {
  const digits = tail(from);
  if (digits.length !== 10) return false;
  const svc = createServiceClient();

  const { count: students } = await svc
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .like("phone", `%${digits}%`);
  if ((students ?? 0) > 0) return true;

  try {
    const { count: leads } = await svc
      .from("leads")
      .select("id", { count: "exact", head: true })
      .like("phone", `%${digits}%`);
    if ((leads ?? 0) > 0) return true;
  } catch { /* leads table optional */ }

  return false;
}

/**
 * Should this inbound message be recorded at all?
 * Everything on the business line: yes. On the personal line: only if the
 * sender is a student or a lead.
 */
export async function shouldRecord(phoneNumberId: string | null | undefined, from: string): Promise<boolean> {
  if (!(await isPersonalLine(phoneNumberId))) return true;
  return isKnownContact(from);
}
