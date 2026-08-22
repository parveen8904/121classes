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
    if (!error) {
      // Clicking any of our email links proves they control the address — so it
      // also clears the "verify your email" banner from the phone-first signup.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { createServiceClient } = await import("@/lib/supabase/service");
          await createServiceClient().from("profiles")
            .update({ email_verified_at: new Date().toISOString() })
            .eq("id", user.id).is("email_verified_at", null);
        }
      } catch { /* never block the redirect on the flag write */ }

      // A RECOVERY link must actually RESULT IN A NEW PASSWORD, not just log the
      // person in. So it always lands on the reset page and carries a short-lived
      // gate cookie; the middleware then keeps them on the reset page until they
      // set a new password (cleared by SetPasswordForm on success). Without this,
      // clicking the reset link left you signed in with the OLD password still
      // valid — email access alone, silently, changing nothing.
      if (type === "recovery") {
        const res = NextResponse.redirect(`${origin}/auth/reset-password`);
        res.cookies.set("pw_reset", "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 1200 });
        return res;
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
