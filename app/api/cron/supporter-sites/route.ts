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
// THIS NOW DECIDES. It did not use to: a finding was written down, a person was
// told, and only a human who had read the page ever put an account on hold —
// because a machine reading a shop page will misread one eventually, and an
// accusation of cheating is not a thing to be wrong about at three in the
// morning. The founder has asked for it to act, so it acts.
//
// The caution moves into the code instead of into a person's judgement:
//   · a site that does not answer is never a breach, only a site that is down;
//   · the words found on the page are stored and quoted back to the vendor;
//   · the vendor is emailed the moment it happens, told how to have it undone
//     for nothing if it is wrong, and the office is told separately;
//   · every hold is written to supporter_holds marked `auto`, so the mistakes
//     can be found rather than merely regretted.

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
    .select("id, full_name, business_name, supporter_site, supporter_site_ok_at")
    .eq("is_supporter", true)
    .not("supporter_site", "is", null)
    .is("supporter_blocked_at", null)
    .limit(400);

  const list = (sellers ?? []) as {
    id: string; full_name: string | null; business_name: string | null;
    supporter_site: string; supporter_site_ok_at: string | null;
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
  const { autoHoldForBreach, isHoldable, PENALTY_INR } = await import("@/lib/supporterHold");
  const found: string[] = [];
  let heldCount = 0;

  for (const seller of due) {
    const r = await inspectSite(seller.supporter_site);
    await recordCheck(seller.id, seller.supporter_site, r);
    if (!isHoldable(r)) continue;

    const outcome = await autoHoldForBreach(seller.id, seller.supporter_site, r);
    if (outcome.held) heldCount++;
    const who = seller.business_name || seller.full_name || seller.id;
    found.push(
      `${who}\n  ${seller.supporter_site}\n  ${r.problem}: ${r.detail}` +
      (r.evidence ? `\n  On the page: “${r.evidence}”` : "") +
      `\n  → ${outcome.held ? `ON HOLD, penalty Rs.${PENALTY_INR}` : outcome.already ? "already on hold" : "not held"}`,
    );
  }

  if (found.length) {
    await notifyFaculty(
      `🚩 ${heldCount} seller${heldCount === 1 ? "" : "s"} put on hold`,
      `${found.join("\n\n")}\n\n` +
        `These were decided automatically from what was on the page, and each seller has been emailed the ` +
        `finding, the words that were found, and how to have it undone for nothing if it is wrong. ` +
        `READ THE PAGES YOURSELF before any penalty is banked — a hold made in error is released from ` +
        `Admin → Supporters and costs the seller nothing.`,
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, checked: due.length, flagged: found.length, held: heldCount });
}
