import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { ordersForDay, parcelsOwed, parcelsOnly, markReported, dispatchWorkbook, dayReportHtml, dayReportRecipients, istDayJustEnded } from "@/lib/dayOrderReport";

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

  // WHAT IS STILL OWED, NOT WHAT ARRIVED YESTERDAY.
  //
  // A calendar window cannot promise that an order landing at the exact moment
  // the mail goes out is not lost between two reports, and it loses a whole day
  // whenever a run fails. So the default asks "what do we still owe the
  // warehouse" — paid, books due, never yet reported — and stamps each parcel
  // only once the email is away. ?day=YYYY-MM-DD still re-sends one date's
  // orders by hand, and never stamps, because it is a copy of something already
  // sent rather than a new instruction to pack.
  const asked = params.get("day");
  const byDay = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null;
  const night = istDayJustEnded();

  const rows = byDay ? parcelsOnly(await ordersForDay(byDay)) : await parcelsOwed();
  const label = byDay ?? night;

  if (params.get("dry") === "1") {
    return NextResponse.json({
      ok: true, mode: byDay ? "re-send of one day" : "everything still owed",
      day: label, count: rows.length, recipients: await dayReportRecipients(), rows,
    });
  }

  // A TEST GOES TO ONE NAMED ADDRESS AND CHANGES NOTHING.
  // It must never stamp: a test that marked sixteen parcels as reported would
  // delete them from the real list the packer is waiting for.
  const testTo = (params.get("test") ?? "").trim().toLowerCase();
  const to = testTo && testTo.includes("@") ? [testTo] : await dayReportRecipients();
  if (!to.length) {
    return NextResponse.json({ ok: false, day: label, count: rows.length, sent: 0,
      error: "nobody to send to — set WAREHOUSE_EMAIL on Integrations, or day_report_email in site settings" }, { status: 500 });
  }

  const { sendEmailWithAttachment, emailShell } = await import("@/lib/notify");
  const subject = `${testTo ? "[TEST] " : ""}\u{1F4E6} ${rows.length} parcel(s) to pack`;
  const html = emailShell(subject, dayReportHtml(label, rows));
  // A real .xlsx, not a CSV renamed — see dispatchWorkbook().
  const attachment = await dispatchWorkbook(rows, label);
  let sent = 0;
  const failed: string[] = [];
  for (const address of to) {
    const ok = await sendEmailWithAttachment(address, subject, html, attachment).catch(() => false);
    if (ok) sent++; else failed.push(address);
  }

  // STAMP ONLY WHAT WAS ACTUALLY DELIVERED SOMEWHERE, AND ONLY ON A REAL RUN.
  // Send first, stamp second: a parcel seen twice is a nuisance, a parcel
  // stamped and never sent is one nobody ever packs.
  let stamped = 0;
  if (!testTo && !byDay && sent > 0) stamped = await markReported(rows);

  return NextResponse.json({
    ok: sent > 0, mode: testTo ? "test" : byDay ? "re-send" : "nightly",
    day: label, count: rows.length, sent, stamped, to, ...(failed.length ? { failed } : {}),
  }, { status: sent > 0 ? 200 : 500 });
}
