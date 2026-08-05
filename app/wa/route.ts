import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// caparveensharma.com/wa → the WhatsApp chat.
//
// A short link that fits on a poster, in a YouTube description, in an SMS, and
// under a QR code — and one we control. Telling a student to "search for us on
// WhatsApp" or printing a raw number invites them to reach the wrong line; this
// opens the right chat in one tap and can never point at a stale number,
// because it reads the number from the same setting the site uses.
//
// ?t= prefills the first message, so an ad about the study planner can open a
// chat that already says which page they came from.
export async function GET(req: NextRequest) {
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("value").eq("key", "support_whatsapp").maybeSingle();
  const digits = String(data?.value ?? "").replace(/\D/g, "");
  if (!digits) return NextResponse.redirect(new URL("/support", req.url), 302);

  // A ten-digit Indian number needs the country code for wa.me to work at all.
  const number = digits.length === 10 ? `91${digits}` : digits;
  const text = req.nextUrl.searchParams.get("t");
  const url = `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text.slice(0, 300))}` : ""}`;
  return NextResponse.redirect(url, 302);
}
