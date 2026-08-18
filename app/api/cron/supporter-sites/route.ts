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
// FOR ONE MONTH IT WARNS RATHER THAN DECIDES. It went straight to holding
// accounts, and on 15 August it fined three vendors ₹5,000 each for discounts
// that belonged to other teachers — one of them the founder's own company. So
// until 18 September a finding is put to the vendor as a warning, first, second
// and third; a third comes to the office as a question, not as a block. After
// that the holds below resume, on sites proved by the vendor's own code.
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
    .select("id, full_name, business_name, supporter_site, supporter_site_ok_at, supporter_site_proof")
    .eq("is_supporter", true)
    .not("supporter_site", "is", null)
    .is("supporter_blocked_at", null)
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
  const { autoHoldForBreach, isHoldable, PENALTY_INR } = await import("@/lib/supporterHold");
  const { warnForBreach, graceUntil } = await import("@/lib/supporterWarn");

  // THE MONTH'S AMNESTY. While this is set, nothing is held and nothing is
  // charged: a finding becomes a warning to the vendor, and a third warning is
  // brought to the office rather than acted on. Set on 18 August, to run to
  // 18 September — `site_settings.supporter_grace_until` moves it.
  const grace = await graceUntil();

  const found: string[] = [];
  const warned: string[] = [];
  const toDecide: string[] = [];
  let heldCount = 0;

  for (const seller of due) {
    const r = await inspectSite(seller.supporter_site);
    await recordCheck(seller.id, seller.supporter_site, r);
    if (!isHoldable(r)) continue;

    const whoIs = seller.business_name || seller.full_name || seller.id;

    // ── THE MONTH: A WARNING, NOT A HOLD ─────────────────────────────────
    if (grace) {
      const w = await warnForBreach(
        seller.id, seller.supporter_site, r, grace, seller.supporter_site_proof === "code",
      );
      if (w.warned) {
        warned.push(
          `${whoIs} — warning ${w.number}${w.emailed ? "" : " (NOT emailed — no address on file)"}\n` +
          `  ${seller.supporter_site}\n  ${r.problem}: ${r.detail}` +
          (r.evidence ? `\n  On the page: “${r.evidence}”` : ""),
        );
        if (w.escalated) {
          toDecide.push(
            `${whoIs} has now had ${w.number} warnings about ${seller.supporter_site}.\n` +
            `  Latest: ${r.problem} — ${r.detail}`,
          );
        }
      }
      continue;
    }

    // A PENALTY NEEDS THE SITE TO BE PROVED, NOT MERELY DECLARED.
    //
    // Where the vendor published our token, the address is theirs beyond
    // argument and what is on it is their doing. Where the office simply
    // vouched for the address, nobody has confirmed the two belong together —
    // and taking ₹5,000 off somebody for a page that might not even be theirs
    // is not a mistake that can be undone with an apology. Those are reported
    // for a person to read instead.
    const proved = seller.supporter_site_proof === "code";
    const outcome = proved
      ? await autoHoldForBreach(seller.id, seller.supporter_site, r)
      : { held: false, already: false };
    if (outcome.held) heldCount++;
    found.push(
      `${whoIs}\n  ${seller.supporter_site}\n  ${r.problem}: ${r.detail}` +
      (r.evidence ? `\n  On the page: “${r.evidence}”` : "") +
      `\n  → ${outcome.held ? `ON HOLD, penalty Rs.${PENALTY_INR}`
             : outcome.already ? "already on hold"
             : proved ? "not held"
             : "NOT HELD — this site was vouched for, never proved by the code. Read it yourself."}`,
    );
  }

  if (warned.length) {
    const ends = grace ? grace.toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: "Asia/Kolkata" }) : "";
    await notifyFaculty(
      `⚠️ ${warned.length} seller${warned.length === 1 ? "" : "s"} warned — nobody held`,
      `${warned.join("\n\n")}\n\n` +
        `Nothing was held and nothing was charged: warnings only until ${ends}. Each of these sellers has been ` +
        `emailed what was found, the words on the page, and an invitation to tell us if we have misread it.\n\n` +
        `READ THE PAGES YOURSELF — the reader was wrong three times in August, and a warning sent in error is ` +
        `still an accusation somebody has to answer.`,
    ).catch(() => {});
  }

  // A third warning is a question for a person, never an instruction to the
  // machine. This is the only thing the amnesty escalates.
  if (toDecide.length) {
    await notifyFaculty(
      `🟠 ${toDecide.length} seller${toDecide.length === 1 ? " has" : "s have"} had three warnings — your decision`,
      `${toDecide.join("\n\n")}\n\n` +
        `Nobody has been held. If you want any of these accounts stopped, do it from Admin → Supporters; ` +
        `if you would rather ring them, the office number is on their profile.`,
    ).catch(() => {});
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

  return NextResponse.json({
    ok: true,
    checked: due.length,
    grace: grace ? grace.toISOString().slice(0, 10) : null,
    warned: warned.length,
    flagged: found.length,
    held: heldCount,
  });
}
