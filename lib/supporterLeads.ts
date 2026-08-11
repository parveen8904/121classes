import { createServiceClient } from "@/lib/supabase/service";

// WHAT BECAME OF A LEAD A VENDOR HANDED US.
//
// A vendor passes on a name. Weeks later they want to know whether anything
// came of it — and, if it did, whether the student bought from them, from us
// directly, or from another vendor. The last of those is the one that causes
// arguments, and the only fair way to settle it is to have written down who
// made the introduction, when, before anybody knew the answer.
//
// Matching is done on phone and email, never on name: two students share a name
// far more often than a mobile number, and crediting an introduction to the
// wrong vendor is worse than crediting it to nobody.

export type PushedLead = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  level: string | null;
  subject_id: string | null;
  address: string | null;
  note: string | null;
  lead_date: string | null;
  created_at: string;
  matched_user_id: string | null;
  converted_at: string | null;
  sold_by: string | null;
};

export type LeadOutcome = {
  /** Has anybody with this phone or email opened an account? */
  signedUp: boolean;
  /** Have they actually paid for something? */
  enrolled: boolean;
  /** "you" | "direct" | "another vendor" | null when not enrolled. */
  through: "you" | "direct" | "other" | null;
  /** The other vendor's name, where it was one. */
  soldByName: string | null;
  when: string | null;
};

/** Digits only, last ten — the shape a phone actually matches on. */
export function phoneKey(v: string | null | undefined): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

export function emailKey(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase();
}

/**
 * Work out what happened to each of a vendor's leads.
 *
 * Done in one pass over the vendor's own rows rather than a query per lead —
 * a vendor with three hundred introductions should not cost three hundred
 * round trips to open their page.
 */
export async function outcomesFor(leads: PushedLead[], viewerId: string): Promise<Map<string, LeadOutcome>> {
  const out = new Map<string, LeadOutcome>();
  if (!leads.length) return out;
  const svc = createServiceClient();

  const phones = [...new Set(leads.map((l) => phoneKey(l.phone)).filter(Boolean))];
  const emails = [...new Set(leads.map((l) => emailKey(l.email)).filter(Boolean))];

  // Everyone who has an account matching one of those contacts.
  const { data: people } = await svc
    .from("profiles").select("id, full_name, email, phone").limit(20000);
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const p of (people ?? []) as { id: string; email: string | null; phone: string | null }[]) {
    const pk = phoneKey(p.phone); if (pk) byPhone.set(pk, p.id);
    const ek = emailKey(p.email); if (ek) byEmail.set(ek, p.id);
  }

  const userIds = [...new Set([
    ...phones.map((p) => byPhone.get(p)).filter(Boolean),
    ...emails.map((e) => byEmail.get(e)).filter(Boolean),
  ])] as string[];

  // What each of those people actually bought, and who sold it to them.
  const paidDirect = new Map<string, string>();          // userId → when
  const paidVendor = new Map<string, { when: string; sellerId: string }>();
  if (userIds.length) {
    const [{ data: own }, { data: gifted }] = await Promise.all([
      svc.from("orders").select("student_id, created_at, status").in("student_id", userIds).eq("status", "paid"),
      svc.from("gift_orders").select("recipient_user_id, gifter_id, created_at, status")
        .in("recipient_user_id", userIds).in("status", ["paid", "provisioned"]),
    ]);
    for (const o of (own ?? []) as { student_id: string; created_at: string }[]) {
      const cur = paidDirect.get(o.student_id);
      if (!cur || o.created_at < cur) paidDirect.set(o.student_id, o.created_at);
    }
    for (const g of (gifted ?? []) as { recipient_user_id: string; gifter_id: string; created_at: string }[]) {
      const cur = paidVendor.get(g.recipient_user_id);
      if (!cur || g.created_at < cur.when) paidVendor.set(g.recipient_user_id, { when: g.created_at, sellerId: g.gifter_id });
    }
  }

  const sellerIds = [...new Set([...paidVendor.values()].map((v) => v.sellerId))];
  const sellerName = new Map<string, string>();
  if (sellerIds.length) {
    const { data: sellers } = await svc.from("profiles").select("id, full_name, business_name").in("id", sellerIds);
    for (const s of (sellers ?? []) as { id: string; full_name: string | null; business_name: string | null }[]) {
      sellerName.set(s.id, s.business_name || s.full_name || "another vendor");
    }
  }

  for (const l of leads) {
    const uid = byPhone.get(phoneKey(l.phone)) ?? byEmail.get(emailKey(l.email)) ?? null;
    if (!uid) { out.set(l.id, { signedUp: false, enrolled: false, through: null, soldByName: null, when: null }); continue; }

    const viaVendor = paidVendor.get(uid);
    const direct = paidDirect.get(uid);
    // Whichever came first is the sale that counts; a student who later
    // extends directly did not stop being this vendor's introduction.
    const vendorFirst = viaVendor && (!direct || viaVendor.when <= direct);

    if (vendorFirst) {
      const mine = viaVendor!.sellerId === viewerId;
      out.set(l.id, {
        signedUp: true, enrolled: true,
        through: mine ? "you" : "other",
        soldByName: mine ? null : sellerName.get(viaVendor!.sellerId) ?? "another vendor",
        when: viaVendor!.when,
      });
    } else if (direct) {
      out.set(l.id, { signedUp: true, enrolled: true, through: "direct", soldByName: null, when: direct });
    } else {
      out.set(l.id, { signedUp: true, enrolled: false, through: null, soldByName: null, when: null });
    }
  }
  return out;
}

/** In the words a vendor would use, not a status code. */
export function outcomeLabel(o: LeadOutcome | undefined): { text: string; tone: "good" | "warn" | "plain" } {
  if (!o) return { text: "—", tone: "plain" };
  if (!o.signedUp) return { text: "No account yet", tone: "plain" };
  if (!o.enrolled) return { text: "Signed up, not paid yet", tone: "warn" };
  if (o.through === "you") return { text: "✅ Enrolled — through you", tone: "good" };
  if (o.through === "direct") return { text: "Enrolled — bought directly from us", tone: "warn" };
  return { text: `Enrolled — through ${o.soldByName ?? "another vendor"}`, tone: "warn" };
}
