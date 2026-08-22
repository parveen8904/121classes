"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// useLayoutEffect on the client, useEffect on the server (it would warn during
// SSR). Lets us correct the button BEFORE the browser paints, so a signed-in
// visitor never sees a "Log in" flash.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Is the Supabase auth cookie present? A synchronous, instant read of
// document.cookie — unlike getSession(), which is async and is what caused the
// visible "Log in" flash on the cached landing page (worst in the app webview).
// Matches sb-<project-ref>-auth-token, including the chunked .0/.1 variants.
function hasAuthCookie(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)sb-[^=;]*-auth-token(?:\.\d+)?=/.test(document.cookie);
}

// Tracks whether the visitor is signed in — starts from the server-rendered
// value, then corrects itself on the client. It seeds from the auth cookie
// synchronously (before paint) so the button reads "My dashboard" instantly for
// a signed-in person, then confirms with getSession. It re-checks on the
// `pageshow` event, which fires when the browser restores a page from the
// back/forward cache — so pressing Back to the landing page (or the app
// reopening a stored page) reflects the real state, not a stale "Log in".
export function useSignedIn(initial: boolean): boolean {
  const [signedIn, setSignedIn] = useState(initial);

  useIsoLayoutEffect(() => {
    if (hasAuthCookie()) setSignedIn(true);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (active) setSignedIn(!!data.session);
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => check());
    const onShow = () => {
      if (hasAuthCookie()) setSignedIn(true);
      check();
    };
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
