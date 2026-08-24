import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { ordersForDay, parcelsOnly, dayReportCsv, dayReportHtml, dayReportRecipients, istDayJustEnded } from "@/lib/dayOrderReport";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// THE DAY'S PARCELS, AT THE END OF THE DAY.
//
// Fires at 18:30 UTC, which is 00:00 IST — and that is 00:00 IST OF THE NEXT
// DAY, which is precisely what this got wrong. The comment here used to say
// this was "the moment the day it reports on finishes", and the code then asked
// istToday() for the day to report: the day that had just begun. Every
// spreadsheet the warehouse received covered a day zero seconds old and
// contained nothing but a header row.
//
// It now reports the day that has just ENDED, and only the parcels in it —
// paid, with books actually due, from students, supporters and vendors alike.
//
// ?day=YYYY-MM-DD re-sends a particular day by hand. ?dry=1 returns the rows
// without emailing anyone, which is how this was checked without putting a test
// message in the warehouse operator's inbox.
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // THE DAY THAT JUST ENDED, NOT THE ONE JUST STARTING. This called istToday(),
  // and at 18:30 UTC — when the cron fires — the IST calendar has already
  // rolled over to the next day, so every report covered a day zero seconds
  // old and went out empty. See istDayJustEnded().
  const asked = params.get("day");
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : istDayJustEnded();

  // Everything that happened, then only the parcels: paid, and with books
  // actually due. Both counts are reported so a quiet night is distinguishable
  // from a filter that has gone wrong.
  const everything = await ordersForDay(day);
  const rows = parcelsOnly(everything);

  if (params.get("dry") === "1") {
    return NextResponse.json({
      ok: true, day, count: rows.length, ofTotalOrders: everything.length,
      recipients: await dayReportRecipients(), rows,
    });
  }

  const to = await dayReportRecipients();
  if (!to.length) return NextResponse.json({ ok: true, day, count: rows.length, sent: 0, note: "nobody holds the warehouse area" });

  const { sendEmailWithAttachment, emailShell } = await import("@/lib/notify");
  const html = emailShell(`Orders — ${day}`, dayReportHtml(day, rows));
  let sent = 0;
  for (const address of to) {
    const ok = await sendEmailWithAttachment(
      address,
      `📦 ${rows.length} parcel(s) to send — orders paid on ${day}`,
      html,
      {
        filename: `orders-${day}.csv`,
        contentType: "text/csv",
        content: Buffer.from(dayReportCsv(rows), "utf8"),
      },
    ).catch(() => false);
    if (ok) sent++;
  }
  return NextResponse.json({ ok: true, day, count: rows.length, ofTotalOrders: everything.length, sent, to });
}
