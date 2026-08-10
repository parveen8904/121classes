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
