import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/notify";
import { courierLabel, trackingUrl } from "@/lib/courierTracking";

// "YOUR BOOKS ARE ON THE WAY", WITH THE NUMBER IN IT.
//
// Entering a tracking number used to change a row in the database and nothing
// else — no page showed it and no email carried it, so the student learnt
// where the parcel was by asking. This sends one email at the moment the
// warehouse hands the parcel over.
//
// ONE EMAIL PER PARCEL, EVER. The stamp is written BEFORE the send is
// attempted, and only when it was previously empty. That ordering is the whole
// guard: if the send fails, or the process dies halfway, the parcel stays
// quiet instead of being tried again on the next pass. A student who misses
// one dispatch email is a small problem; a student who receives the same one
// every night is the problem I spent this morning undoing.

export type DispatchTable = "book_orders" | "orders" | "gift_orders";

/** Who to write to, and what the parcel contains — different on each table. */
async function recipientFor(table: DispatchTable, id: string): Promise<{ to: string; name: string; what: string; studentId: string | null; phone: string | null; telegram: string | null } | null> {
  const svc = createServiceClient();

  if (table === "gift_orders") {
    const { data } = await svc
      .from("gift_orders")
      .select("recipient_email, recipient_name, recipient_user_id, subjects:subject_id(title)")
      .eq("id", id).maybeSingle();
    const r = data as unknown as { recipient_email: string | null; recipient_name: string | null; recipient_user_id: string | null; subjects: { title: string } | null } | null;
    if (!r?.recipient_email) return null;
    return { to: r.recipient_email, name: r.recipient_name ?? "", what: `${r.subjects?.title ?? "your course"} books`, studentId: r.recipient_user_id, phone: null, telegram: null };
  }

  if (table === "orders") {
    const { data } = await svc
      .from("orders")
      .select("student_id, profiles:student_id(full_name, email, phone, telegram_chat_id), subjects:subject_id(title)")
      .eq("id", id).maybeSingle();
    const r = data as unknown as { student_id: string | null; profiles: { full_name: string | null; email: string | null; phone: string | null; telegram_chat_id: string | null } | null; subjects: { title: string } | null } | null;
    if (!r?.profiles?.email) return null;
    return { to: r.profiles.email, name: r.profiles.full_name ?? "", what: `${r.subjects?.title ?? "your course"} books`, studentId: r.student_id, phone: r.profiles.phone, telegram: r.profiles.telegram_chat_id };
  }

  const { data } = await svc
    .from("book_orders")
    .select("student_id, guest_contact, items, profiles:student_id(full_name, email, phone, telegram_chat_id)")
    .eq("id", id).maybeSingle();
  const r = data as unknown as {
    student_id: string | null;
    guest_contact: { email?: string; name?: string; phone?: string } | null;
    items: unknown;
    profiles: { full_name: string | null; email: string | null; phone: string | null; telegram_chat_id: string | null } | null;
  } | null;
  // Signed in when they ordered, or a guest who left an email at checkout.
  const to = r?.profiles?.email || r?.guest_contact?.email || "";
  if (!to) return null;
  const titles = Array.isArray(r?.items)
    ? (r!.items as { title?: unknown }[]).map((i) => String(i?.title ?? "")).filter(Boolean)
    : [];
  return {
    to,
    name: r?.profiles?.full_name || r?.guest_contact?.name || "",
    what: titles.length ? titles.join(", ") : "your books",
    studentId: r?.student_id ?? null,
    phone: r?.profiles?.phone || r?.guest_contact?.phone || null,
    telegram: r?.profiles?.telegram_chat_id ?? null,
  };
}

/**
 * Tell one student their parcel has gone. Safe to call more than once: the
 * second call does nothing. Never throws — a courier update must not fail
 * because a mail server was slow.
 */
export async function notifyDispatch(table: DispatchTable, id: string): Promise<boolean> {
  try {
    const svc = createServiceClient();

    const { data: row } = await svc
      .from(table)
      .select("order_no, tracking_code, courier_name, dispatch_notified_at")
      .eq("id", id).maybeSingle();
    const r = row as { order_no: number | null; tracking_code: string | null; courier_name: string | null; dispatch_notified_at: string | null } | null;
    if (!r?.tracking_code || r.dispatch_notified_at) return false;

    // CLAIM IT FIRST. `is null` in the filter means two passes racing each
    // other cannot both win — the second updates no rows and stops here.
    const { data: claimed } = await svc
      .from(table)
      .update({ dispatch_notified_at: new Date().toISOString() })
      .eq("id", id).is("dispatch_notified_at", null)
      .select("id");
    if (!claimed?.length) return false;

    const who = await recipientFor(table, id);
    if (!who) return false;

    const courier = courierLabel(r.courier_name);
    const url = trackingUrl(r.courier_name, r.tracking_code);
    const orderNo = r.order_no ? String(r.order_no) : "";

    const html = `
      <p>Dear ${who.name || "Student"},</p>
      <p>Your books have been handed to the courier and are on their way.</p>
      <table cellpadding="6" style="border-collapse:collapse;font-size:15px">
        ${orderNo ? `<tr><td style="color:#666">Order</td><td><strong>${orderNo}</strong></td></tr>` : ""}
        <tr><td style="color:#666">Contents</td><td>${who.what}</td></tr>
        <tr><td style="color:#666">Courier</td><td><strong>${courier || "—"}</strong></td></tr>
        <tr><td style="color:#666">Tracking number</td><td><strong style="font-family:monospace;font-size:16px">${r.tracking_code}</strong></td></tr>
      </table>
      ${url
        ? `<p style="margin:20px 0"><a href="${url}" style="background:#0d9488;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600">Track this parcel</a></p>`
        : `<p>Search that number on the ${courier || "courier"}'s website to see where it is.</p>`}
      <p>Most addresses receive the parcel in <strong>3–4 days</strong>. You can always see this on
         <a href="https://caparveensharma.com/dashboard/deliveries">your books page</a>.</p>
      <p>If anything is wrong with the parcel when it reaches you, reply to this email with the order number and
         we will put it right.</p>
      <p>— CA Parveen Sharma classes</p>`;

    const mailed = await sendEmail(who.to, `📦 Your books are on the way${orderNo ? ` — order ${orderNo}` : ""}`, html);

    // HIS ASK, 26 Aug 2026: "as soon as you get the tracking number that
    // should be shared with the student" — on the phone and the chats, not
    // only in a mailbox they may open days later. Every channel is
    // best-effort and none may fail the others: the email above is the one
    // that always exists, the rest reach whoever has the app, Telegram or
    // WhatsApp connected.
    const line =
      `📦 Your books are on the way!\n` +
      `${who.what}${orderNo ? ` (order ${orderNo})` : ""}\n` +
      `Courier: ${courier || "—"}\nTracking: ${r.tracking_code}` +
      (url ? `\n${url}` : "");
    if (who.studentId) {
      try {
        const { pushToUser } = await import("@/lib/push");
        await pushToUser(who.studentId, {
          title: "📦 Your books are on the way",
          body: `${courier || "Courier"} · ${r.tracking_code}`,
          link: "/dashboard/deliveries",
        });
      } catch { /* no devices is the common case, not a fault */ }
    }
    if (who.telegram) {
      try {
        const { sendTelegramMessage } = await import("@/lib/notify");
        await sendTelegramMessage(who.telegram, line, url || undefined);
      } catch { /* unlinked or blocked — the email carries it */ }
    }
    if (who.phone) {
      try {
        // Free-form WhatsApp lands only inside an open 24-hour window; a buyer
        // an hour after checkout usually has one. Outside it, Meta drops the
        // message silently and the email still carries the number.
        const { sendWhatsAppText } = await import("@/lib/notify");
        await sendWhatsAppText(who.phone, line);
      } catch { /* best-effort */ }
    }
    return mailed;
  } catch {
    // A courier update must never fail because of the post.
    return false;
  }
}

/** Several parcels at once — the manifest upload and the Delhivery booking. */
export async function notifyDispatchMany(parcels: { table: DispatchTable; id: string }[]): Promise<number> {
  let sent = 0;
  for (const p of parcels) if (await notifyDispatch(p.table, p.id)) sent++;
  return sent;
}
