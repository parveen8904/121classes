import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { unsubscribeTokenValid } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

// ONE-CLICK UNSUBSCRIBE, the way mailbox providers do it.
//
// Gmail and Outlook show their own "Unsubscribe" beside the sender's name when
// a message carries List-Unsubscribe-Post. Pressing it POSTs here — no page, no
// reader involvement — and RFC 8058 requires that to be honoured without any
// further step. Getting this right is also what keeps the domain in good
// standing: a provider that sees no working unsubscribe starts sending our mail
// to spam, which would cost every student their password email.
//
// A GET does NOT unsubscribe. Scanners follow links to check them, and a GET
// that acted would remove people who never pressed anything, so it redirects to
// the page that asks.
async function stop(email: string, token: string): Promise<boolean> {
  const addr = String(email ?? "").trim().toLowerCase();
  if (!addr || !(await unsubscribeTokenValid(addr, token))) return false;
  await createServiceClient().from("email_blocklist").upsert(
    { channel: "email", email: addr, reason: "One-click unsubscribe from the mail client" },
    { onConflict: "channel,email" },
  );
  return true;
}

export async function POST(req: NextRequest) {
  const u = new URL(req.url);
  const ok = await stop(u.searchParams.get("e") ?? "", u.searchParams.get("t") ?? "");
  // 200 either way: a provider reads a failure as "unsubscribe is broken" and
  // marks the sender down, and a bad token is not something the reader can fix.
  return NextResponse.json({ ok });
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const e = u.searchParams.get("e") ?? "";
  const t = u.searchParams.get("t") ?? "";
  return NextResponse.redirect(
    new URL(`/unsubscribe?e=${encodeURIComponent(e)}&t=${encodeURIComponent(t)}`, u.origin),
  );
}
