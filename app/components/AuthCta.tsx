"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Tracks whether the visitor is signed in — starts from the server-rendered
// value, then keeps itself correct on the client. Crucially it re-checks on the
// `pageshow` event, which fires when the browser restores a page from the
// back/forward cache — so pressing Back to the landing page reflects the real
// (still-signed-in) state instead of a stale "Log in".
export function useSignedIn(initial: boolean): boolean {
  const [signedIn, setSignedIn] = useState(initial);
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (active) setSignedIn(!!data.session);
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => check());
    const onShow = () => check();
    window.addEventListener("pageshow", onShow);
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("pageshow", onShow);
    };
  }, []);
  return signedIn;
}

// Landing-page top-right button: "Dashboard" when signed in, else "Log in".
//
// prefetch={false} ON BOTH, AND IT MATTERS MORE THAN IT LOOKS.
//
// This button sits in the site header, so it is on every page and always in
// the viewport — and a Link in the viewport is prefetched. Both destinations
// render at request time, so each prefetch is a full server render plus a
// session check against Supabase. Our own analytics counted 1,568 views of
// /login in a day; Vercel served it 13,522 times. The other twelve thousand
// were this button, warming a page nobody had asked for.
//
// A login page does not need to be pre-warmed. It is one click, once.
export default function AuthCta({ initialSignedIn }: { initialSignedIn: boolean }) {
  const signedIn = useSignedIn(initialSignedIn);
  return signedIn ? (
    <Link prefetch={false} className="btn hide-sm" href="/dashboard">
      My dashboard
    </Link>
  ) : (
    <Link prefetch={false} className="btn hide-sm" href="/login">
      Log in
    </Link>
  );
}
