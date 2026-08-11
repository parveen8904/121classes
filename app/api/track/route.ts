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
  const event = ["view", "login_success", "login_failed", "signup_success", "signup_failed"].includes(String(body.event)) ? String(body.event) : "view";
  if (!path && event === "view") return NextResponse.json({ ok: true });

  // WHO IS IT — ASKED ONLY WHEN THE ANSWER MATTERS.
  //
  // auth.getUser() is a network hop to Supabase to verify the token. This
  // beacon fires on EVERY page view — twelve thousand a day — so that was
  // twelve thousand verification round trips a day, each one holding a function
  // open while it waited, to attach a name to a page view that is already
  // identified by its visitor key.
  //
  // The login and signup counters are the ones read as a number of PEOPLE on
  // the health page, so those still ask. An ordinary view does not.
  let userId: string | null = null;
  if (event !== "view") {
    try {
      const { data: { user } } = await createClient().auth.getUser();
      userId = user?.id ?? null;
    } catch { /* anonymous */ }
  }

  // WHERE, NOT WHO.
  //
  // Vercel works out the country and region at its edge and hands them over as
  // headers, so nothing is called and nothing is paid for. Two coarse labels
  // are kept — "IN" and "UP" — and the IP they were derived from is not stored,
  // not logged, and not read for any other purpose.
  //
  // This is as far as it goes, and the limit is not a setting. An IP contains
  // no name, no phone and no email; the vendors who sell "visitor
  // identification" are matching addresses against purchased broker files,
  // which is a different activity with a different legal footing, and this
  // column is not a step towards it.
  //
  // Indian mobile traffic geolocates poorly — the big carriers route through a
  // handful of gateways, so a student in Lucknow often reads as Mumbai. Good
  // enough for "which states are we reaching", useless for anything narrower,
  // and it should not be presented as more than that.
  const country = (req.headers.get("x-vercel-ip-country") ?? "").slice(0, 2).toUpperCase() || null;
  const region = (req.headers.get("x-vercel-ip-country-region") ?? "").slice(0, 8).toUpperCase() || null;

  try {
    await createServiceClient().from("page_views").insert({
      path: path || "/login",
      event,
      user_id: userId,
      visitor_key: String(body.visitor ?? "").slice(0, 64) || null,
      country,
      region,
    });
  } catch { /* analytics must never break the site */ }
  return NextResponse.json({ ok: true });
}
