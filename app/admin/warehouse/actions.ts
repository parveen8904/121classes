"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireArea } from "@/lib/adminAccess";
import { listDispatchQueue } from "@/lib/warehouse";
import { buildShippingLabelsPdf } from "@/lib/shippingLabels";
import { sendEmailWithAttachment } from "@/lib/notify";
import { str } from "../_lib/util";
import { parseDelimited } from "@/lib/delimited";

// Warehouse team enters the courier tracking ID for one parcel. Book orders
// are also marked dispatched.
export async function saveTracking(formData: FormData) {
  if (!(await requireArea("warehouse"))) return;
  const id = str(formData.get("id"));
  const table = str(formData.get("table"));
  const tracking = str(formData.get("tracking")).trim();
  // Which courier it went with. A tracking number is not traceable without it:
  // DEL122019183 means nothing until you know whether that is Delhivery, DTDC
  // or Blue Dart, and the only person who knew was the packer.
  const courier = str(formData.get("courier")).trim();
  if (!id || !tracking || !["orders", "book_orders", "gift_orders"].includes(table)) return;
  const svc = createServiceClient();
  await svc.from(table).update({
    tracking_code: tracking,
    courier_name: courier || null,
    ...(table === "book_orders" ? { status: "dispatched" } : {}),
  }).eq("id", id);
  revalidatePath("/admin/warehouse");
  revalidatePath("/admin/orders");
}

// TRACKING IDS BY THE HUNDRED, NOT ONE AT A TIME.
//
// A courier hands back a manifest: one row per parcel, order number and docket.
// Typing forty of those into forty boxes is twenty minutes of work in which
// exactly one digit will go astray, and the parcel it belongs to will be
// untraceable until a student complains.
//
// So the manifest is uploaded. Any CSV with a column that looks like an order
// number and one that looks like a tracking number is understood; a courier
// column is used when present. Rows that do not match a waiting parcel are
// REPORTED, not ignored — a silent skip is how you find out in November that
// eleven parcels were never marked dispatched.
export async function uploadTracking(formData: FormData) {
  if (!(await requireArea("warehouse"))) return;

  const file = formData.get("file");
  const back = new URLSearchParams();
  for (const k of ["from", "to"]) {
    const v = str(formData.get(k));
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) back.set(k, v);
  }
  const qs = back.toString() ? `&${back}` : "";
  if (!(file instanceof File) || file.size === 0) redirect(`/admin/warehouse?upload=nofile${qs}`);
  if (file.size > 2_000_000) redirect(`/admin/warehouse?upload=toobig${qs}`);

  const text = await file.text();
  const rows = parseDelimited(text);
  if (rows.length < 1) redirect(`/admin/warehouse?upload=empty${qs}`);

  // Which column is which. Read from the header when there is one, guessed
  // from the shape of the data when there is not.
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const findCol = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h.includes(n)));
  let orderCol = findCol("order", "reference", "ref");
  let trackCol = findCol("track", "docket", "awb", "consignment", "waybill");
  let courierCol = findCol("courier", "carrier", "partner");
  const hasHeader = orderCol >= 0 || trackCol >= 0;
  if (orderCol < 0) orderCol = 0;
  if (trackCol < 0) trackCol = 1;

  const body = hasHeader ? rows.slice(1) : rows;

  // Only parcels actually waiting can be marked — a manifest cannot reach back
  // and overwrite something dispatched last month.
  const queue = await listDispatchQueue(true);
  const byOrderNo = new Map<string, (typeof queue)[number]>();
  for (const q of queue) {
    const digits = q.orderNo.replace(/\D/g, "");
    if (digits) byOrderNo.set(digits, q);
  }

  const svc = createServiceClient();
  let saved = 0;
  const unmatched: string[] = [];

  for (const r of body) {
    const orderRaw = (r[orderCol] ?? "").trim();
    const tracking = (r[trackCol] ?? "").trim();
    const courier = courierCol >= 0 ? (r[courierCol] ?? "").trim() : "";
    if (!orderRaw && !tracking) continue;                   // a blank line at the end of a file
    const key = orderRaw.replace(/\D/g, "");
    const parcel = key ? byOrderNo.get(key) : undefined;
    if (!parcel || !tracking) {
      unmatched.push(orderRaw || "(no order no)");
      continue;
    }
    await svc.from(parcel.table).update({
      tracking_code: tracking,
      ...(courier ? { courier_name: courier } : {}),
      ...(parcel.table === "book_orders" ? { status: "dispatched" } : {}),
    }).eq("id", parcel.id);
    saved++;
  }

  revalidatePath("/admin/warehouse");
  revalidatePath("/admin/orders");
  const miss = unmatched.length ? `&missed=${encodeURIComponent(unmatched.slice(0, 12).join(", "))}` : "";
  redirect(`/admin/warehouse?upload=${saved}${miss}${qs}`);
}

// Build a PDF of shipping labels for every parcel still awaiting a tracking
// ID and email it to the signed-in warehouse user for printing.
export async function emailShippingLabels(formData?: FormData) {
  if (!(await requireArea("warehouse"))) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const to = user?.email;
  if (!to) redirect("/admin/warehouse?labels=fail");

  // WHICH DAY'S PARCELS.
  //
  // The whole queue in one PDF is right on a quiet week and useless on a busy
  // one: a packer dispatching Monday's orders does not want Tuesday's labels
  // in the same stack, printed and then thrown away. Same date in both boxes
  // gives exactly one day.
  const okDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const fromDay = okDate(formData?.get("from"));
  const toDay = okDate(formData?.get("to"));
  const fromMs = fromDay ? new Date(`${fromDay}T00:00:00+05:30`).getTime() : null;
  const toMs = toDay ? new Date(`${toDay}T23:59:59+05:30`).getTime() : null;

  const queue = (await listDispatchQueue(true)).filter((q) => {
    const at = new Date(q.createdAt).getTime();
    if (fromMs !== null && at < fromMs) return false;
    if (toMs !== null && at > toMs) return false;
    return true;
  });
  const range = new URLSearchParams();
  if (fromDay) range.set("from", fromDay);
  if (toDay) range.set("to", toDay);
  const back = range.toString() ? `&${range}` : "";
  if (!queue.length) redirect(`/admin/warehouse?labels=empty${back}`);

  const pdf = await buildShippingLabelsPdf(
    queue.map((q) => ({
      orderNo: q.orderNo, name: q.name, address: q.address, phone: q.phone,
      contents: q.contents,
      // Blank on the label unless we already know them — a docket book is
      // filled in by hand at the counter.
      docket: q.tracking, courier: q.courier,
    })),
    "CA Parveen Sharma classes — caparveensharma.com · 98100 12674",
  );
  const when = fromDay || toDay
    ? ` for ${fromDay || "the beginning"}${toDay && toDay !== fromDay ? ` to ${toDay}` : ""}`
    : "";
  const ok = await sendEmailWithAttachment(
    to!,
    `🏷️ ${queue.length} shipping label(s) to print${when}`,
    `<p>Attached are the shipping labels for the ${queue.length} parcel(s) awaiting dispatch${when}.</p>
     <p>Print, stick, courier — then enter the courier name and tracking ID on the Warehouse page.</p>`,
    { filename: `shipping-labels-${fromDay || new Date().toISOString().slice(0, 10)}.pdf`, contentType: "application/pdf", content: Buffer.from(pdf) },
  );
  redirect(`/admin/warehouse?labels=${ok ? queue.length : "fail"}${back}`);
}
