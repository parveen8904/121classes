import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { ordersForDay, dayReportCsv, dayReportHtml, dayReportRecipients, istToday } from "@/lib/dayOrderReport";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// THE DAY'S ORDERS, AT THE END OF THE DAY.
//
// Fires at midnight IST — 18:30 UTC — which is the moment the day it reports on
// finishes. Reporting on "today" at any earlier hour would send a file that is
// already out of date by the time it is read; reporting the next morning would
// need someone to remember which day it covered.
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

  const asked = params.get("day");
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : istToday();
  const rows = await ordersForDay(day);

  if (params.get("dry") === "1") {
    return NextResponse.json({ ok: true, day, count: rows.length, recipients: await dayReportRecipients(), rows });
  }

  const to = await dayReportRecipients();
  if (!to.length) return NextResponse.json({ ok: true, day, count: rows.length, sent: 0, note: "nobody holds the warehouse area" });

  const { sendEmailWithAttachment, emailShell } = await import("@/lib/notify");
  const html = emailShell(`Orders — ${day}`, dayReportHtml(day, rows));
  let sent = 0;
  for (const address of to) {
    const ok = await sendEmailWithAttachment(
      address,
      `📋 ${rows.length} order(s) on ${day}`,
      html,
      {
        filename: `orders-${day}.csv`,
        contentType: "text/csv",
        content: Buffer.from(dayReportCsv(rows), "utf8"),
      },
    ).catch(() => false);
    if (ok) sent++;
  }
  return NextResponse.json({ ok: true, day, count: rows.length, sent, to });
}
