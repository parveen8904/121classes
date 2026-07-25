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
  if (!id || !tracking || !["orders", "book_orders"].includes(table)) return;
  const svc = createServiceClient();
  await svc.from(table).update({
    tracking_code: tracking,
    ...(table === "book_orders" ? { status: "dispatched" } : {}),
  }).eq("id", id);
  revalidatePath("/admin/warehouse");
  revalidatePath("/admin/orders");
}

// Build a PDF of shipping labels for every parcel still awaiting a tracking
// ID and email it to the signed-in warehouse user for printing.
export async function emailShippingLabels() {
  if (!(await requireArea("warehouse"))) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const to = user?.email;
  if (!to) redirect("/admin/warehouse?labels=fail");

  const queue = await listDispatchQueue(true);
  if (!queue.length) redirect("/admin/warehouse?labels=empty");

  const pdf = await buildShippingLabelsPdf(
    queue.map((q) => ({ orderNo: q.orderNo, name: q.name, address: q.address, phone: q.phone, contents: q.contents })),
    "CA Parveen Sharma classes — caparveensharma.com · 98100 12674",
  );
  const ok = await sendEmailWithAttachment(
    to!,
    `🏷️ ${queue.length} shipping label(s) to print`,
    `<p>Attached are the shipping labels for the ${queue.length} parcel(s) awaiting dispatch.</p>
     <p>Print, stick, courier — then enter each tracking ID on the Warehouse page.</p>`,
    { filename: `shipping-labels-${new Date().toISOString().slice(0, 10)}.pdf`, contentType: "application/pdf", content: Buffer.from(pdf) },
  );
  redirect(`/admin/warehouse?labels=${ok ? queue.length : "fail"}`);
}
