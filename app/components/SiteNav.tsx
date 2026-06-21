import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import MobileMenu from "./MobileMenu";
import AuthCta from "./AuthCta";

const NAV_LINKS = [
  { href: "/courses", label: "Courses" },
  { href: "/test-series", label: "Test Series" },
  { href: "/results", label: "Results" },
  { href: "/books", label: "Books" },
  { href: "/#contact", label: "Contact" },
];

export default async function SiteNav() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signedIn = !!user;

  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <Link href="/" aria-label="CA Parveen Sharma home" className="lp-brand">
          <Logo />
        </Link>
        <div className="lp-nav-links">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} className="hide-sm" href={l.href}>
              {l.label}
            </Link>
          ))}
          <ThemeToggle />
          <AuthCta initialSignedIn={signedIn} />
          <MobileMenu links={NAV_LINKS} initialSignedIn={signedIn} />
        </div>
      </div>
    </nav>
  );
}
