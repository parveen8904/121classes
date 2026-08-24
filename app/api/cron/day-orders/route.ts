import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { ordersForDay, parcelsOnly, markReported, dispatchWorkbook, dayReportHtml, dayReportRecipients, istDayJustEnded } from "@/lib/dayOrderReport";

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

  // ONE WINDOW: 00:00 to 00:00 IST of the day being reported. Nothing else.
  //
  // This grew two extra ideas and he was right to cut them out. First it sent
  // "everything still owed", age-blind, so a stamping backlog arrived as a
  // month of orders. Then I filtered the already-reported half by placement
  // date but left the owed half age-blind — one sheet obeying two rules, which
  // is worse than either. The rule is now the one he stated: the orders placed
  // on that IST day, paid, with books to send.
  //
  // If a night's run fails, that day is re-sent by hand with ?day=YYYY-MM-DD —
  // an explicit act, rather than a silent catch-up that makes the next sheet
  // unpredictable.
  const asked = params.get("day");
  const byDay = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null;
  const day = byDay ?? istDayJustEnded();
  const label = day;
  const rows = parcelsOnly(await ordersForDay(day));

  if (params.get("dry") === "1") {
    return NextResponse.json({
      ok: true, mode: byDay ? "re-send of one day" : "the day just ended",
      day: label, count: rows.length, recipients: await dayReportRecipients(), rows,
    });
  }

  // A TEST GOES TO ONE NAMED ADDRESS AND CHANGES NOTHING.
  // It must never stamp: a test that marked sixteen parcels as reported would
  // delete them from the real list the packer is waiting for.
  // A DAY WITH NOTHING AT ALL sends one plain line and NO attachment — a
  // header-only spreadsheet is noise wearing the costume of a failure.
  const testTo = (params.get("test") ?? "").trim().toLowerCase();
  const to = testTo && testTo.includes("@") ? [testTo] : await dayReportRecipients();
  if (!to.length) {
    return NextResponse.json({ ok: false, day: label, count: rows.length, sent: 0,
      error: "nobody to send to — set WAREHOUSE_EMAIL on Integrations, or day_report_email in site settings" }, { status: 500 });
  }

  const { sendEmailWithAttachment, emailShell } = await import("@/lib/notify");
  const subject = rows.length === 0
    ? `${testTo ? "[TEST] " : ""}\u{2705} Nothing to pack — no book orders on ${label}`
    : `${testTo ? "[TEST] " : ""}\u{1F4E6} ${rows.length} parcel(s) to pack — orders of ${label}`;
  const intro = rows.length === 0
    ? `<p>No paid order with books to send was placed on <strong>${label}</strong>.</p>`
    : "";
  const html = emailShell(subject, intro + dayReportHtml(label, rows));
  // A real .xlsx, not a CSV renamed — and only when there is something on it.
  const attachment = rows.length > 0 ? await dispatchWorkbook(rows, label) : null;
  let sent = 0;
  const failed: string[] = [];
  for (const address of to) {
    const ok = await (attachment
      ? sendEmailWithAttachment(address, subject, html, attachment)
      : (await import("@/lib/notify")).sendEmail(address, subject, html)
    ).catch(() => false);
    if (ok) sent++; else failed.push(address);
  }

  // STAMP ONLY WHAT WAS ACTUALLY DELIVERED SOMEWHERE, AND ONLY ON A REAL RUN.
  // Send first, stamp second: a parcel seen twice is a nuisance, a parcel
  // stamped and never sent is one nobody ever packs.
  let stamped = 0;
  // Stamped as a RECORD of what was sent, not as a filter — the window decides
  // the contents, so a parcel appears on exactly one night: that of the day it
  // was placed.
  if (!testTo && !byDay && sent > 0) stamped = await markReported(rows);

  return NextResponse.json({
    ok: sent > 0, mode: testTo ? "test" : byDay ? "re-send" : "nightly",
    day: label, count: rows.length, sent, stamped, to, ...(failed.length ? { failed } : {}),
  }, { status: sent > 0 ? 200 : 500 });
}
