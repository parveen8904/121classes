import { createServiceClient } from "@/lib/supabase/service";
import { formatDate, formatDateTime } from "@/lib/dates";
import { parsePostalParts } from "@/lib/indiaStates";
import { matchesState } from "@/lib/accountsExport";

// THE DAY'S ORDERS, SENT WITHOUT ANYONE ASKING.
//
// Pawan works the warehouse and needs the day's sales in front of him at the
// start of the next one — not a login, not a filter he has to set, not a button
// he has to remember. A report you have to go and fetch is a report that gets
// fetched on the days it does not matter.
//
// It goes at 00:30 IST — his choice, 25 Aug 2026: half an hour past the day it
// covers, so an order landing at the stroke of midnight is settled into the
// right day before the file is made — and the file
// he opens in the morning is complete and never changes afterwards.
//
// Every kind of sale is in it. A parcel does not care whether the money came
// from a student's own card, a vendor's, or a sponsor's — the books still have
// to go in a box — and a report that showed only one of the three would send
// him looking for orders that are not there.

export type DayOrderRow = {
  /** Which table and row this came from — so the send can stamp it as reported. */
  table: "orders" | "book_orders" | "gift_orders";
  id: string;
  /** When this parcel was already reported to the warehouse — null = not yet.
   *  The nightly mail includes the whole day, marked, so a daytime button
   *  press no longer produces a midnight sheet with nothing on it. */
  reportedAt?: string | null;
  orderNo: string;
  kind: string;
  student: string;
  email: string;
  phone: string;
  course: string;
  months: string;
  amount: number;
  status: string;
  booksDue: boolean;
  address: string;
  // CITY, STATE AND PIN GET COLUMNS OF THEIR OWN.
  //
  // A courier's upload sheet sorts on a PIN code and wants the state in its own
  // field. One mashed-together address column means somebody retypes every
  // parcel by hand, and a PIN mistyped at 6am is a parcel that goes to the
  // wrong district. The warehouse spreadsheet has had these three columns all
  // along; the nightly report is the one that was still sending prose.
  city: string;
  state: string;
  pincode: string;
  placedAt: string;
};

/** The IST day boundaries for a YYYY-MM-DD, as UTC instants. */
export function istDayBounds(day: string): { from: string; to: string } {
  return {
    from: new Date(`${day}T00:00:00+05:30`).toISOString(),
    to: new Date(`${day}T23:59:59.999+05:30`).toISOString(),
  };
}

/** The IST calendar day containing `now`. */
export function istToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/**
 * THE DAY THAT HAS JUST FINISHED — which is not the one istToday() returns.
 *
 * This is why the warehouse spreadsheet was arriving EMPTY every night. Vercel
 * runs crons in UTC; the original schedule `30 18 * * *` fired at 00:00 IST
 * OF THE NEXT DAY. So istToday() named the day that was just BEGINNING, the
 * report asked for orders between 00:00 and 23:59 of a day that was zero
 * seconds old, and the file went out with nothing in it but a header row.
 *
 * The attachment sent on 13 Aug (UTC) was called orders-2026-08-14.csv and
 * covered 14 August at the instant it started. Eleven orders were placed that
 * day — every one of them hours after the packer had been sent the sheet.
 *
 * Stepping back an hour before reading the calendar lands on the day that has
 * just ended: at the current 00:30 IST firing (0 19 * * * UTC) that is 23:30
 * the previous evening. The hour also absorbs cron drift — any firing between
 * 00:00 and 00:59 IST names the same, correct day.
 */
export function istDayJustEnded(now = new Date()): string {
  return istToday(new Date(now.getTime() - 60 * 60 * 1000));
}

const SUBS_COLS = "id, order_no, amount_inr, status, books_due, created_at, months:subject_id, subjects:subject_id(title, courses(title)), profiles:student_id(full_name, email, phone, address_line1, address_line2, city, state, pincode)";
const BOOKS_COLS = "id, order_no, amount_inr, status, created_at, ship_to, guest_contact, items";
const GIFTS_COLS = "id, order_no, amount_inr, status, books_due, months, created_at, recipient_name, recipient_email, recipient_phone, recipient_address, subjects:subject_id(title, courses(title)), profiles:gifter_id(full_name, business_name)";

/**
 * EVERY PARCEL STILL OWED, WHENEVER IT WAS ORDERED.
 *
 * This replaces "the orders placed on day X" as what the warehouse is sent, and
 * it is the answer to his second requirement: "make sure that any orders exact
 * on a particular time of sending mail are not missed next day."
 *
 * A calendar window cannot promise that. Whatever boundary is chosen, an order
 * landing on the wrong side of it by a millisecond falls between two reports
 * and is never packed — and if a night's run fails outright, that whole day is
 * lost with it and nobody finds out.
 *
 * So the question asked is not "what came in yesterday" but "what do we still
 * owe": paid, books due, and never yet sent to the warehouse. A parcel stays on
 * the list until it has actually been reported, and is stamped only after the
 * email is away. An order placed in the same second as the send either makes
 * this run or is still unstamped and makes the next one. Nothing can fall in a
 * gap, nothing is sent twice, and a missed night simply appears the following
 * one.
 */
/**
 * EVERYTHING ALREADY REPORTED SINCE AN INSTANT — the other half of the night's
 * picture. On 24 Aug the day's two parcels went out on a 21:15 button press,
 * so the midnight sheet was legitimately empty — and from the founder's chair
 * an empty sheet is indistinguishable from the pipeline being broken again
 * ("very bad"). The nightly mail now carries owed PLUS already-reported-today,
 * marked apart; only the owed are stamped, so nothing is ever double-counted.
 */
export async function parcelsReportedSince(fromIso: string): Promise<DayOrderRow[]> {
  const svc = createServiceClient();
  const paid = ["paid", "provisioned", "dispatched", "delivered"];
  const [subs, books, gifts] = await Promise.all([
    svc.from("orders").select(SUBS_COLS + ", warehouse_notified_at")
      .in("status", paid).eq("books_due", true).gte("warehouse_notified_at", fromIso).order("created_at"),
    svc.from("book_orders").select(BOOKS_COLS + ", warehouse_notified_at")
      .in("status", ["paid", "dispatched", "delivered"]).gte("warehouse_notified_at", fromIso).order("created_at"),
    svc.from("gift_orders").select(GIFTS_COLS + ", warehouse_notified_at")
      .in("status", paid).eq("books_due", true).gte("warehouse_notified_at", fromIso).order("created_at"),
  ]);
  const stamp = new Map<string, string>();
  for (const res of [subs, books, gifts]) {
    for (const r of ((res.data ?? []) as unknown as { id: string; warehouse_notified_at: string }[])) {
      stamp.set(String(r.id), String(r.warehouse_notified_at));
    }
  }
  return buildRows(subs, books, gifts).map((r) => ({ ...r, reportedAt: stamp.get(r.id) ?? null }));
}

export async function parcelsOwed(): Promise<DayOrderRow[]> {
  const svc = createServiceClient();

  // THE THREE TABLES DO NOT SPEAK THE SAME STATUS LANGUAGE.
  //
  // orders.status and gift_orders.status are plain text and will accept any
  // value, but book_orders.status is a Postgres ENUM — book_order_status, whose
  // only members are paid, dispatched, delivered and cancelled. Asking it for
  // "provisioned" is not an empty result, it is a TYPE ERROR that rejects the
  // whole query: `invalid input value for enum book_order_status`. That took
  // /admin/orders down until it was caught here.
  //
  // "provisioned" is a vendor-sale state anyway — it is how a gift_order says
  // it has been paid for and handed over. A book order never enters it, so
  // asking for it was meaningless as well as fatal.
  const PAID_TEXT = ["paid", "provisioned", "dispatched", "delivered"];
  const PAID_BOOK_ENUM = ["paid", "dispatched", "delivered"];

  const [subs, books, gifts] = await Promise.all([
    svc.from("orders").select(SUBS_COLS)
      .in("status", PAID_TEXT).eq("books_due", true).is("warehouse_notified_at", null).order("created_at"),
    svc.from("book_orders").select(BOOKS_COLS)
      .in("status", PAID_BOOK_ENUM).is("warehouse_notified_at", null).order("created_at"),
    svc.from("gift_orders").select(GIFTS_COLS)
      .in("status", PAID_TEXT).eq("books_due", true).is("warehouse_notified_at", null).order("created_at"),
  ]);
  return buildRows(subs, books, gifts);
}

/** Every order placed on one IST day, whatever its state — for a re-send of a
 *  particular date, and for looking at what a day actually contained. */
export async function ordersForDay(day: string): Promise<DayOrderRow[]> {
  const svc = createServiceClient();
  const { from, to } = istDayBounds(day);

  const [subs, books, gifts] = await Promise.all([
    svc.from("orders").select(SUBS_COLS)
      .gte("created_at", from).lte("created_at", to).order("created_at"),
    svc.from("book_orders").select(BOOKS_COLS)
      .gte("created_at", from).lte("created_at", to).order("created_at"),
    svc.from("gift_orders").select(GIFTS_COLS)
      .gte("created_at", from).lte("created_at", to).order("created_at"),
  ]);
  return buildRows(subs, books, gifts);
}

type Res = { data: unknown; error: { message: string } | null };
function buildRows(subs: Res, books: Res, gifts: Res): DayOrderRow[] {

  // A REFUSED QUERY IS NOT A QUIET DAY.
  //
  // These three were read straight into `(x.data ?? [])`, so a PostgREST
  // refusal — a bad embed, an RLS policy, a renamed column — produced an empty
  // array that is indistinguishable from "nothing was sold". The warehouse
  // would be sent a header row and no reason, exactly as if trade had stopped.
  // It throws now: a cron that fails loudly gets fixed, one that sends an empty
  // sheet does not.
  for (const [what, res] of [["subscriptions", subs], ["book orders", books], ["vendor/sponsored orders", gifts]] as const) {
    if (res.error) {
      throw new Error(`the day report could not read ${what}: ${res.error.message}. Nothing was sent rather than sending an incomplete list.`);
    }
  }

  const out: DayOrderRow[] = [];
  const courseOf = (s: unknown): string => {
    const c = (s as { courses?: { title?: string } | { title?: string }[] } | null)?.courses;
    return (Array.isArray(c) ? c[0]?.title : c?.title) ?? "";
  };

  for (const r of (subs.data ?? []) as unknown as Record<string, never>[]) {
    const p = r.profiles as unknown as Record<string, string | null> | null;
    const s = r.subjects as unknown;
    out.push({
      table: "orders", id: String(r.id),
      orderNo: r.order_no ? `#${r.order_no}` : "—",
      kind: "Subscription",
      student: String(p?.full_name ?? ""),
      email: String(p?.email ?? ""),
      phone: String(p?.phone ?? ""),
      course: [courseOf(s), (s as { title?: string } | null)?.title].filter(Boolean).join(" · "),
      months: "",
      amount: Number(r.amount_inr) || 0,
      status: String(r.status ?? ""),
      booksDue: Boolean(r.books_due),
      address: [p?.address_line1, p?.address_line2, [p?.city, p?.state, p?.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      // Held as separate fields on the profile, so they are simply read.
      city: String(p?.city ?? ""),
      state: String(p?.state ?? ""),
      pincode: String(p?.pincode ?? ""),
      placedAt: String(r.created_at),
    });
  }

  for (const r of (books.data ?? []) as unknown as Record<string, never>[]) {
    const s = (r.ship_to ?? {}) as Record<string, string | undefined>;
    const g = (r.guest_contact ?? {}) as Record<string, string | undefined>;
    const items = (r.items ?? []) as unknown as { qty?: number }[];
    out.push({
      table: "book_orders", id: String(r.id),
      orderNo: r.order_no ? `#${r.order_no}` : "—",
      kind: "Books",
      student: s.name ?? g.name ?? "",
      email: s.email ?? g.email ?? "",
      phone: s.phone ?? g.phone ?? "",
      course: `${items.length} book line(s)`,
      months: "",
      amount: Number(r.amount_inr) || 0,
      status: String(r.status ?? ""),
      booksDue: true,
      address: [s.line1, s.line2, [s.city, s.state, s.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      // ship_to is the address the buyer typed at checkout, already in fields.
      city: s.city ?? "",
      state: s.state ?? "",
      pincode: s.pincode ?? "",
      placedAt: String(r.created_at),
    });
  }

  for (const r of (gifts.data ?? []) as unknown as Record<string, never>[]) {
    const seller = r.profiles as unknown as Record<string, string | null> | null;
    const s = r.subjects as unknown;
    const who = seller?.business_name || seller?.full_name || "";
    out.push({
      table: "gift_orders", id: String(r.id),
      orderNo: r.order_no ? `#${r.order_no}` : "—",
      // Whose sale it was matters to the warehouse: a vendor's parcel is
      // queried through the vendor, not the student.
      kind: who ? `Vendor / sponsored — ${who}` : "Vendor / sponsored",
      student: String(r.recipient_name ?? ""),
      email: String(r.recipient_email ?? ""),
      phone: String(r.recipient_phone ?? ""),
      course: [courseOf(s), (s as { title?: string } | null)?.title].filter(Boolean).join(" · "),
      months: r.months ? `${r.months} months` : "",
      amount: Number(r.amount_inr) || 0,
      status: String(r.status ?? ""),
      booksDue: Boolean(r.books_due),
      address: String(r.recipient_address ?? "").split("\n").filter(Boolean).join(", "),
      // THE ONLY ONE WE HAVE TO GUESS AT. A gift is addressed in a single free
      // text box, so the parts are read back out: the PIN by its six digits,
      // the state by matching the list of real ones, the city as the piece just
      // before the state. Where a piece cannot be identified it is left EMPTY
      // rather than filled with a guess — a blank cell tells the packer to look
      // at the address column, and a wrong PIN sends the parcel to Kerala.
      ...parsePostalParts(String(r.recipient_address ?? "")),
      placedAt: String(r.created_at),
    });
  }

  out.sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  return out;
}

/**
 * WHAT THE WAREHOUSE IS ACTUALLY SENT: PARCELS, NOT SALES.
 *
 * His instruction, 24 Aug 2026: "The orders must be paid orders and they should
 * include the orders from direct students or supporters or vendors, but only
 * paid orders where we are supposed to send books, only these will be attached
 * here, not all orders."
 *
 * Two conditions, and both matter to the person packing:
 *
 *   · PAID. An unpaid order is not a parcel. On 14 August seven of the eleven
 *     orders were still `created` — an abandoned checkout is not something to
 *     put in a box, and a packer who ships one has given the books away.
 *
 *   · BOOKS ACTUALLY DUE. A subscription without a printed set has nothing to
 *     send. It belongs in a sales report, not on a packing bench.
 *
 * WHERE IT DOES NOT DISCRIMINATE is just as deliberate: a student's own card, a
 * supporter's sponsorship and a vendor's sale all reach this list, because the
 * books go in the same box whoever paid for them. That is why all three tables
 * are read above.
 *
 * "Paid" is matchesState(…, "paid") — the same definition the accounts desk and
 * the sales report use, so a vendor sale sitting in `provisioned` is recognised
 * as paid rather than quietly dropped. That exact trap once kept every vendor
 * order away from the warehouse.
 */
/**
 * MARK THEM REPORTED — ONLY AFTER THE EMAIL IS ACTUALLY AWAY.
 *
 * The order matters and is deliberate: send first, stamp second. Stamping first
 * and then failing to send would erase the parcel from every future report and
 * nobody would ever learn it had been dropped. Stamping after means the worst
 * case is that a parcel appears twice — visible, and trivially resolved by the
 * packer — rather than silently never.
 */
export async function markReported(rows: DayOrderRow[]): Promise<number> {
  if (!rows.length) return 0;
  const svc = createServiceClient();
  const at = new Date().toISOString();
  let stamped = 0;
  for (const table of ["orders", "book_orders", "gift_orders"] as const) {
    const ids = rows.filter((r) => r.table === table).map((r) => r.id);
    if (!ids.length) continue;
    // In chunks: a few hundred UUIDs in one .in() is the URL-length trap that
    // reads back as an empty result rather than an error. See lib/pageAll.ts.
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const { error } = await svc.from(table).update({ warehouse_notified_at: at }).in("id", batch);
      if (error) throw new Error(`the parcels were emailed but could not be marked as reported (${table}): ${error.message}`);
      stamped += batch.length;
    }
  }
  return stamped;
}

export function parcelsOnly(rows: DayOrderRow[]): DayOrderRow[] {
  return rows.filter((r) => r.booksDue && matchesState(r.status, "paid"));
}

const inr = (n: number) => "Rs. " + Math.round(n).toLocaleString("en-IN");

/**
 * A REAL EXCEL WORKBOOK, BECAUSE THAT IS WHAT WAS ASKED FOR.
 *
 * The nightly mail carried a .csv — and before that, the 18:00 run carried no
 * attachment at all, which is the mail he opened and found empty-handed. A CSV
 * does open in Excel, but it is not an Excel file: the columns arrive unsized,
 * a PIN code beginning in zero is eaten as a number, and there is nothing to
 * freeze the header against while scrolling four hundred parcels.
 *
 * So this writes a genuine .xlsx with the sheetjs build already in the project.
 * Everything is written as TEXT — phone numbers, PIN codes and order numbers
 * are identifiers, not quantities, and Excel will happily turn 011... into 11
 * and a long phone number into 9.81e9. Amount stays numeric, because that one
 * really is a quantity and the packer may want to total it.
 */
export async function dispatchWorkbook(rows: DayOrderRow[], label: string): Promise<{
  filename: string; contentType: string; content: Buffer;
}> {
  const XLSX = await import("xlsx");
  const head = ["Order no", "Type", "Student", "Email", "Phone", "Course", "Term", "Amount", "Status", "Books to send",
                "Address", "City", "State", "PIN code", "Placed at", "Reported"];
  const aoa: unknown[][] = [head];
  for (const r of rows) {
    aoa.push([
      r.orderNo, r.kind, r.student, r.email, r.phone, r.course, r.months,
      Math.round(r.amount), r.status, r.booksDue ? "YES" : "no",
      r.address, r.city, r.state, r.pincode, formatDate(r.placedAt),
      // NEW TONIGHT is the packer's cue; a row sent to them earlier the same
      // day says when, so the sheet is the whole day without double work.
      r.reportedAt ? `earlier today · ${formatDateTime(r.reportedAt)}` : "NEW — pack this",
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Force the identifier columns to text so Excel stops "helping".
  const textCols = [0, 4, 13]; // Order no, Phone, PIN code
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let R = 1; R <= range.e.r; R++) {
    for (const C of textCols) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v !== undefined && cell.v !== null) { cell.t = "s"; cell.v = String(cell.v); }
    }
  }
  ws["!cols"] = [
    { wch: 10 }, { wch: 26 }, { wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 26 }, { wch: 10 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 42 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 26 },
  ];
  ws["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(range.e.r, 1), c: head.length - 1 } }) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Parcels to pack");
  const content = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return {
    filename: `parcels-${label}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    content,
  };
}

export function dayReportCsv(rows: DayOrderRow[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const head = ["Order no", "Type", "Student", "Email", "Phone", "Course", "Term", "Amount", "Status", "Books to send",
                "Address", "City", "State", "PIN code", "Placed at"];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push([
      esc(r.orderNo), esc(r.kind), esc(r.student), esc(r.email), esc(r.phone),
      esc(r.course), esc(r.months), esc(Math.round(r.amount)), esc(r.status),
      esc(r.booksDue ? "YES" : "no"),
      esc(r.address), esc(r.city), esc(r.state),
      // Quoted like everything else, which keeps a PIN starting in zero intact —
      // Excel would otherwise read 110092 as a number and eat a leading zero.
      esc(r.pincode),
      esc(r.placedAt),
    ].join(","));
  }
  return "﻿" + lines.join("\r\n");
}

export function dayReportHtml(day: string, rows: DayOrderRow[]): string {
  // Money that actually arrived. A started-and-abandoned checkout is not a sale
  // and counting it would overstate the day every single morning.
  const paid = rows.filter((r) => ["paid", "provisioned", "dispatched", "delivered"].includes(r.status));
  const took = paid.reduce((s, r) => s + r.amount, 0);
  const toShip = paid.filter((r) => r.booksDue);

  if (rows.length === 0) {
    // The rows reaching here are already only the parcels — paid, books due —
    // so "no orders were placed" would be wrong as well as unhelpful: there may
    // have been plenty of orders and simply nothing to pack.
    return `<p>Nothing to pack for <strong>${formatDate(`${day}T06:00:00Z`)}</strong> — no paid order that day has books to send.</p>`;
  }

  const cell = "padding:6px 9px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top";
  const rowsHtml = rows.map((r) => `<tr>
      <td style="${cell}"><strong>${r.orderNo}</strong></td>
      <td style="${cell}">${r.kind}</td>
      <td style="${cell}">${r.student}<br><span style="color:#666">${r.email || "no email"} · ${r.phone || "no number"}</span></td>
      <td style="${cell}">${r.course}${r.months ? ` · ${r.months}` : ""}</td>
      <td style="${cell};text-align:right">${inr(r.amount)}</td>
      <td style="${cell}">${r.status}${r.booksDue ? " · <strong>books</strong>" : ""}</td>
      <td style="${cell};color:#666">${r.address || "—"}${
        r.pincode || r.state
          ? `<br><span style="color:#111">${[r.city, r.state].filter(Boolean).join(", ")}${r.pincode ? ` · <strong>${r.pincode}</strong>` : ""}</span>`
          : ""
      }</td>
    </tr>`).join("");

  return `
    <p>Orders placed on <strong>${formatDate(`${day}T06:00:00Z`)}</strong>.</p>
    <p style="line-height:1.8">
      <strong>${rows.length}</strong> order(s) in total ·
      <strong>${paid.length}</strong> paid, worth <strong>${inr(took)}</strong> ·
      <strong>${toShip.length}</strong> need books sent.
    </p>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr>
        <th style="${cell};text-align:left">Order</th>
        <th style="${cell};text-align:left">Type</th>
        <th style="${cell};text-align:left">Student</th>
        <th style="${cell};text-align:left">Course</th>
        <th style="${cell};text-align:right">Amount</th>
        <th style="${cell};text-align:left">Status</th>
        <th style="${cell};text-align:left">Address</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p style="color:#666;font-size:12px">The same rows are attached as a spreadsheet.</p>`;
}

/**
 * Who gets it.
 *
 * The warehouse area, not a name typed into a file. If the operator changes,
 * or a second one is taken on, the report follows the job rather than needing
 * somebody to remember this exists. `day_report_email` in site_settings adds
 * anyone else who wants a copy.
 */
/**
 * EVERYONE WHO GETS THE NIGHTLY SHEET — ONE EMAIL, ONE LIST.
 *
 * There were two warehouse emails on two schedules: this one after midnight IST
 * with the spreadsheet, and a separate 18:00 IST dispatch note with an HTML
 * table and no attachment, going to WAREHOUSE_EMAIL. Two lists, two moments,
 * two different definitions of what was owed — and the packer had to reconcile
 * them. They are now one, so WAREHOUSE_EMAIL is folded in here.
 */
export async function dayReportRecipients(): Promise<string[]> {
  const svc = createServiceClient();
  const { getSecret } = await import("@/lib/secrets");
  const [{ data: staff }, { data: extra }, warehouse] = await Promise.all([
    svc.from("profiles").select("email, role, permissions").in("role", ["admin", "operator"]).limit(200),
    svc.from("site_settings").select("value").eq("key", "day_report_email").maybeSingle(),
    getSecret("WAREHOUSE_EMAIL"),
  ]);
  const out = new Set<string>();
  for (const p of (staff ?? []) as { email: string | null; role: string; permissions: string[] | null }[]) {
    if (!p.email) continue;
    if (p.role === "operator" && (p.permissions ?? []).includes("warehouse")) out.add(p.email);
  }
  // The warehouse's own address, and anyone else he has added on the settings
  // page — his own address among them, so he sees exactly what the packer sees.
  for (const source of [String((extra as { value?: string } | null)?.value ?? ""), String(warehouse ?? "")]) {
    for (const e of source.split(/[,\s]+/)) {
      if (e.includes("@")) out.add(e.trim().toLowerCase());
    }
  }
  return [...out];
}
