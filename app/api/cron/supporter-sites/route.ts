import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyFaculty } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// READING THE SHOPFRONTS, NIGHTLY.
//
// A hundred and five supporters sell these courses from their own sites. Nobody
// has ever looked at one. The two things the agreement forbids — more than five
// per cent off, and bundling with another faculty — are both visible on a
// public page, and neither is visible from here unless somebody goes and looks.
//
// IT DECIDES NOTHING AND SENDS NOTHING. It reads, and it tells the office.
//
// It used to hold accounts by itself. On 15 August it fined three vendors
// ₹5,000 each and emailed each of them an accusation, for discounts that
// belonged to other teachers — one of the three was the founder's own company.
// His instruction of 18 August is the rule now: do not hold on your own, and do
// not write to a vendor without asking us first. We check the fault, then you
// send the mail.
//
// So every finding here becomes a DRAFT for Admin → Supporters:
//   · nothing is held, ever, by this route — a hold is a person's act;
//   · nothing reaches a vendor until somebody has opened the page and pressed
//     send, and the warning number is decided at that moment;
//   · a site that does not answer is never a breach, only a site that is down;
//   · the words found on the page are stored, so the office reads what the
//     machine read and can see for itself when it has misread.

const PER_RUN = 25;

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // The ones checked longest ago come first, so every site comes round in turn
  // rather than the same twenty-five being read for ever.
  const { data: sellers } = await svc
    .from("profiles")
    .select("id, full_name, business_name, supporter_site, supporter_site_ok_at, supporter_site_proof")
    .eq("is_supporter", true)
    .not("supporter_site", "is", null)
    .is("supporter_blocked_at", null)
    // The founder's own businesses are not resellers. Aldine was held, fined
    // and emailed an accusation on 15 August for selling his own courses in
    // his own combos, on his own site.
    .eq("supporter_compliance_exempt", false)
    .limit(400);

  const list = (sellers ?? []) as {
    id: string; full_name: string | null; business_name: string | null;
    supporter_site: string; supporter_site_ok_at: string | null;
    supporter_site_proof: string | null;
  }[];
  if (!list.length) return NextResponse.json({ ok: true, checked: 0 });

  // When each was last looked at, so the queue rotates.
  const { data: last } = await svc
    .from("supporter_site_checks")
    .select("supporter_id, checked_at")
    .in("supporter_id", list.map((s) => s.id))
    .order("checked_at", { ascending: false })
    .limit(2000);
  const lastSeen = new Map<string, string>();
  for (const r of last ?? []) {
    const id = String(r.supporter_id);
    if (!lastSeen.has(id)) lastSeen.set(id, String(r.checked_at));
  }

  const due = list
    .sort((a, b) => (lastSeen.get(a.id) ?? "") .localeCompare(lastSeen.get(b.id) ?? ""))
    .slice(0, PER_RUN);

  const { inspectSite, recordCheck } = await import("@/lib/supporterSite");
  const { isHoldable } = await import("@/lib/supporterHold");
  const { draftWarning } = await import("@/lib/supporterWarn");

  const drafted: string[] = [];

  for (const seller of due) {
    const r = await inspectSite(seller.supporter_site);
    await recordCheck(seller.id, seller.supporter_site, r);
    if (!isHoldable(r)) continue;

    const whoIs = seller.business_name || seller.full_name || seller.id;

    // Written down for a person to read. Not sent, not held, not charged.
    const d = await draftWarning(seller.id, seller.supporter_site, r);
    if (!d.drafted) continue;

    drafted.push(
      `${whoIs}\n  ${seller.supporter_site}\n  ${r.problem}: ${r.detail}` +
      (r.evidence ? `\n  On the page: “${r.evidence}”` : "") +
      (seller.supporter_site_proof === "code"
        ? ""
        : `\n  (this address was vouched for, never proved by their own code — it may not even be their page)`),
    );
  }

  if (drafted.length) {
    await notifyFaculty(
      `📋 ${drafted.length} thing${drafted.length === 1 ? "" : "s"} to check on sellers' sites`,
      `${drafted.join("\n\n")}\n\n` +
        `NOTHING HAS BEEN SENT AND NOBODY IS HELD. These are waiting for you at ` +
        `Admin → Supporters: open each page yourself, then press Send if the fault is real or Dismiss if the ` +
        `machine has misread it. It was wrong three times in August, so the reading below is a suggestion, ` +
        `not a finding.`,
    ).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    checked: due.length,
    drafted: drafted.length,
    held: 0,   // this route no longer holds anybody, ever
    emailedVendors: 0,
  });
}
