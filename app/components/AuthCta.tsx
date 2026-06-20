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
export default function AuthCta({ initialSignedIn }: { initialSignedIn: boolean }) {
  const signedIn = useSignedIn(initialSignedIn);
  return signedIn ? (
    <Link className="btn hide-sm" href="/dashboard">
      My dashboard
    </Link>
  ) : (
    <Link className="btn hide-sm" href="/login">
      Log in
    </Link>
  );
}
