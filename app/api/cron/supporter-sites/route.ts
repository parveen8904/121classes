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
// NOTHING IS DECIDED HERE. A finding is written down and a person is told. An
// account is only ever put on hold by a human being who has read the page, and
// the supporter is shown the exact words that were found. A machine that reads
// a shop page will misread one eventually, and an accusation of cheating is not
// a thing to be wrong about at three in the morning.

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
  const found: string[] = [];

  for (const seller of due) {
    const r = await inspectSite(seller.supporter_site);
    await recordCheck(seller.id, seller.supporter_site, r);
    if (!r.ok && r.problem !== "unreachable") {
      const who = seller.business_name || seller.full_name || seller.id;
      found.push(
        `${who}\n  ${seller.supporter_site}\n  ${r.problem}: ${r.detail}` +
        (r.evidence ? `\n  On the page: “${r.evidence}”` : ""),
      );
    }
  }

  if (found.length) {
    await notifyFaculty(
      `🚩 ${found.length} supporter site${found.length === 1 ? "" : "s"} need a look`,
      `${found.join("\n\n")}\n\n` +
        `Nothing has been done to any account. Read the pages yourself, and put an account on ` +
        `hold from Admin → Supporters if it is right to.`,
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, checked: due.length, flagged: found.length });
}
