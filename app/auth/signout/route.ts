import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Cleanly ends the session (clears auth cookies) and bounces to login. Used by
// the single-device check when a session has been superseded on another device.
export async function GET(request: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();
  cookies().delete("dsid");
  const reason = new URL(request.url).searchParams.get("reason");
  const url = new URL("/login", request.url);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}
