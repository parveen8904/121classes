import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// Faculty WhatsApp bridge. The faculty's number is NEVER sent to the browser —
// the page links here with just the subject id. We look the number up
// server-side and 302 the student straight into a WhatsApp chat, with their
// doubt pre-filled. So students can message the faculty without ever seeing,
// copying, or saving the raw number from the page.
export async function GET(req: NextRequest) {
  const subjectId = req.nextUrl.searchParams.get("subject") ?? "";
  const text = req.nextUrl.searchParams.get("text") ?? "";

  // Only logged-in students can use the bridge (stops public scraping of the
  // endpoint). The learn area already requires a session.
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!subjectId) return NextResponse.redirect(new URL("/dashboard", req.url));

  // Find a faculty on this subject who has a phone number.
  const svc = createServiceClient();
  const { data } = await svc
    .from("subject_faculty")
    .select("faculties(phone)")
    .eq("subject_id", subjectId);

  const phones = ((data ?? []) as unknown as { faculties: { phone: string | null } | { phone: string | null }[] | null }[])
    .flatMap((r) => (Array.isArray(r.faculties) ? r.faculties : r.faculties ? [r.faculties] : []))
    .map((f) => f.phone)
    .filter((p): p is string => !!p);
  const raw = phones[0];
  if (!raw) {
    // No faculty number set — send them back rather than leaking anything.
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  const digits = raw.replace(/\D/g, "");
  const wa = digits.length === 10 ? `91${digits}` : digits;
  const target = `https://wa.me/${wa}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
  return NextResponse.redirect(target);
}
