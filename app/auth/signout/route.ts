import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Cleanly ends the session (clears auth cookies) and bounces to login. Used by
// the single-device check when a session has been superseded on another device.
export async function GET(request: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();
  (await cookies()).delete("dsid");
  const reason = new URL(request.url).searchParams.get("reason");
  // Forced sign-out (e.g. used on another device) → /login with the reason;
  // a normal sign-out returns to the landing page.
  const url = reason ? new URL("/login", request.url) : new URL("/", request.url);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}
