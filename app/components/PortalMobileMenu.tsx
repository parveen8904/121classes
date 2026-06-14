"use client";

import Link from "next/link";
import { useState } from "react";
import SignOutButton from "@/app/dashboard/sign-out";

type NavLink = { href: string; label: string };

// Hamburger menu for the signed-in portal header on small screens.
// Desktop links live in PortalHeader and are hidden via CSS on mobile.
export default function PortalMobileMenu({
  links,
  signedIn,
}: {
  links: NavLink[];
  signedIn: boolean;
}) {
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
            {signedIn && (
              <div className="nav-drawer-signout" onClick={close}>
                <SignOutButton />
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
