import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LoginForm from "./login-form";

export const metadata = {
  // A sign-in form is not a search result. Crawlable so Google can read this and drop the page, which robots.txt blocking could never achieve.
  robots: { index: false, follow: true },
};

// Render at request time (never statically pre-render this auth page at build).
export const dynamic = "force-dynamic";

export default async function LoginPage(props: { searchParams: Promise<{ next?: string }> }) {
  // Already signed in? Then a "(log in)" button — the homepage career links, the
  // placements "See all openings" — must take them straight to where they were
  // going, not show a sign-in form they don't need. Without this, a logged-in
  // user pressing those buttons landed on the email-link page and it looked
  // broken. Only same-site paths are honoured (no open redirect).
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/auth/home";
    redirect(next);
  }

  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
