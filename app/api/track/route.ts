import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// First-party page-view / login-event beacon (sent by app/components/Tracker
// and the login form). One tiny insert per event; powers /admin/health's
// Visitors report. No third-party analytics, nothing leaves our database.
export async function POST(req: NextRequest) {
  let body: { path?: string; event?: string; visitor?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: true }); }
  const path = String(body.path ?? "").slice(0, 300);
  const event = ["view", "login_success", "login_failed"].includes(String(body.event)) ? String(body.event) : "view";
  if (!path && event === "view") return NextResponse.json({ ok: true });

  // Who is it (if logged in)? Cookie comes along on same-origin beacons.
  let userId: string | null = null;
  try {
    const { data: { user } } = await createClient().auth.getUser();
    userId = user?.id ?? null;
  } catch { /* anonymous */ }

  try {
    await createServiceClient().from("page_views").insert({
      path: path || "/login",
      event,
      user_id: userId,
      visitor_key: String(body.visitor ?? "").slice(0, 64) || null,
    });
  } catch { /* analytics must never break the site */ }
  return NextResponse.json({ ok: true });
}
