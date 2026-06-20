"use client";

import Link from "next/link";
import { useState } from "react";
import { useSignedIn } from "./AuthCta";

type NavLink = { href: string; label: string };

// Hamburger menu shown only on small screens (the desktop links are hidden
// via .hide-sm in globals.css). Keeps every landing-page page reachable on mobile.
export default function MobileMenu({ links, initialSignedIn = false }: { links: NavLink[]; initialSignedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const signedIn = useSignedIn(initialSignedIn);

  return (
    <>
      <button
        type="button"
        className="nav-burger"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "✕" : "☰"}
      </button>

      {open && (
        <>
          <div className="nav-scrim" onClick={close} />
          <div className="nav-drawer" role="menu">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={close} role="menuitem">
                {l.label}
              </Link>
            ))}
            <Link className="btn block" href={signedIn ? "/dashboard" : "/login"} onClick={close}>
              {signedIn ? "My dashboard" : "Log in"}
            </Link>
          </div>
        </>
      )}
    </>
  );
}
