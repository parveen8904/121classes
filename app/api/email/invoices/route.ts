import { NextResponse, type NextRequest } from "next/server";
import { verifyMailgunSignature } from "@/lib/mailgunSignature";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// THE BILLS DOOR — alerts@caparveensharma.com, and nothing else.
//
// Provider invoices must never travel through the student bridge. That channel
// answers people, and a channel that answers is a channel that can loop: it is
// exactly how the July loop started, and the founder ruled the email desk out
// for that reason. So the bills get their own door, on their own address, and
// the rule of this route is absolute:
//
//   IT NEVER SENDS ANYTHING. No reply, no forward, no notification.
//
// It reads the message, files any PDF invoice into the accounting vault, and
// answers Mailgun with 200. With no outbound path there is no loop to form,
// whoever writes to it and whatever they send.
//
// Mailgun setup (founder): route mail for alerts@caparveensharma.com to
//   POST https://caparveensharma.com/api/email/invoices
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: true }); // never make Mailgun retry a malformed post
  }
  if (!(await verifyMailgunSignature(form))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const from = String(form.get("from") ?? form.get("sender") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const count = Number(form.get("attachment-count") ?? 0);

  try {
    const atts: File[] = [];
    for (let i = 1; i <= count; i++) {
      const a = form.get(`attachment-${i}`);
      if (a && typeof a === "object" && "arrayBuffer" in a) atts.push(a as File);
    }
    const { fileInvoiceFromMail } = await import("@/lib/invoiceMail");
    const filed = await fileInvoiceFromMail({
      from, subject,
      messageId: String(form.get("Message-Id") ?? form.get("message-id") ?? ""),
      attachments: atts,
    });
    return NextResponse.json({ ok: true, filed });
  } catch {
    // A billing hiccup is not worth a Mailgun retry storm.
    return NextResponse.json({ ok: true, filed: 0 });
  }
}
