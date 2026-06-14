"use client";

import Link from "next/link";
import { useState } from "react";

type NavLink = { href: string; label: string };

// Hamburger menu shown only on small screens (the desktop links are hidden
// via .hide-sm in globals.css). Keeps every landing-page page reachable on mobile.
export default function MobileMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

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
            <Link className="btn block" href="/login" onClick={close}>
              Log in
            </Link>
          </div>
        </>
      )}
    </>
  );
}
