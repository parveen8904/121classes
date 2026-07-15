import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { zoomSignature } from "@/lib/zoomSdk";

export const dynamic = "force-dynamic";

// Returns a short-lived Zoom Meeting SDK signature for a live session — ONLY to
// a logged-in student. The zoom.us link/number is never exposed to the browser
// as a shareable URL; the SDK joins from inside our page.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "login" }, { status: 401 });

  let body: { sessionId?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  if (!body.sessionId) return NextResponse.json({ error: "bad" }, { status: 400 });

  const svc = createServiceClient();
  const { data: s } = await svc
    .from("live_sessions")
    .select("id, title, zoom_meeting_number, zoom_passcode, is_published")
    .eq("id", body.sessionId)
    .maybeSingle();
  if (!s || !s.is_published || !s.zoom_meeting_number) return NextResponse.json({ error: "unavailable" }, { status: 404 });

  const sig = await zoomSignature(String(s.zoom_meeting_number), 0);
  if (!sig) return NextResponse.json({ error: "unconfigured" }, { status: 503 });

  const { data: prof } = await svc.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  return NextResponse.json({
    signature: sig.signature,
    sdkKey: sig.sdkKey,
    meetingNumber: String(s.zoom_meeting_number).replace(/\D/g, ""),
    passcode: s.zoom_passcode ?? "",
    userName: prof?.full_name || (user.email ?? "Student"),
    userEmail: user.email ?? "",
    title: s.title,
  });
}
