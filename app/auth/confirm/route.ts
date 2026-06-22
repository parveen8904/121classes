import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Email-link verification using the token_hash flow. Unlike the implicit/hash
// flow (which puts tokens in the URL fragment the server can't read), this works
// entirely server-side: verifyOtp confirms the email AND sets the session cookie,
// then we send the user to the right next step:
//   signup / magiclink  -> /auth/set-password  (new user picks their password)
//   recovery            -> /auth/reset-password (user sets a new password)
type OtpType = "signup" | "magiclink" | "recovery" | "invite" | "email" | "email_change";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as OtpType | null;
  let next = searchParams.get("next") || "/dashboard";
  if (!next.startsWith("/")) next = "/dashboard"; // only ever redirect within the site

  if (tokenHash && type) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
