import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { ordersForDay, parcelsOwed, parcelsReportedSince, parcelsOnly, markReported, dispatchWorkbook, dayReportHtml, dayReportRecipients, istDayJustEnded, istDayBounds } from "@/lib/dayOrderReport";

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

  // THE NIGHTLY MAIL IS THE WHOLE DAY, NOT JUST THE REMAINDER.
  //
  // On 24 Aug the day's two parcels went out on a 21:15 button press, so the
  // midnight sheet was legitimately empty — and an empty sheet from this
  // pipeline reads as the pipeline broken again. The night's Excel now lists
  // what is still owed AND what was already reported since the day began, a
  // "Reported" column telling them apart. Only the owed are stamped.
  const label = byDay ?? night;
  const owed = byDay ? parcelsOnly(await ordersForDay(byDay)) : await parcelsOwed();
  const already = byDay ? [] : await parcelsReportedSince(istDayBounds(night).from);
  const rows = [...owed, ...already];

  if (params.get("dry") === "1") {
    return NextResponse.json({
      ok: true, mode: byDay ? "re-send of one day" : "everything still owed",
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
  const newCount = owed.length;
  const subject = testTo ? `[TEST] \u{1F4E6} ${newCount} parcel(s) to pack`
    : rows.length === 0 ? `\u{2705} Nothing to pack — no parcels today`
    : newCount === 0 ? `\u{2705} Nothing new to pack — all ${already.length} parcel(s) already sent to you today`
    : `\u{1F4E6} ${newCount} parcel(s) to pack` + (already.length ? ` (+${already.length} already sent today)` : "");
  const intro = rows.length === 0
    ? "<p>No paid order with books to send arrived today. Nothing is owed.</p>"
    : newCount === 0
      ? `<p>Every parcel of the day — ${already.length} — was already emailed to you earlier today (see the Reported column). Nothing new is owed tonight.</p>`
      : already.length
        ? `<p><strong>${newCount} new</strong> parcel(s) below are marked <strong>NEW — pack this</strong>; ${already.length} more were already sent to you earlier today and are listed for the full day's picture.</p>`
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
  if (!testTo && !byDay && sent > 0) stamped = await markReported(owed);

  return NextResponse.json({
    ok: sent > 0, mode: testTo ? "test" : byDay ? "re-send" : "nightly",
    day: label, count: rows.length, sent, stamped, to, ...(failed.length ? { failed } : {}),
  }, { status: sent > 0 ? 200 : 500 });
}
