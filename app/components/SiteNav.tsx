import Link from "next/link";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import MobileMenu from "./MobileMenu";
import AuthCta from "./AuthCta";

const NAV_LINKS = [
  { href: "/courses", label: "Courses" },
  { href: "/build-your-plan", label: "Build your plan" },
  { href: "/results", label: "Results" },
  { href: "/books", label: "Books" },
  { href: "/startups", label: "Startups" },
  { href: "/placements", label: "Placements" },
  { href: "/#contact", label: "Contact" },
];

// No server-side auth read here — reading cookies would force every marketing
// page to render dynamically (no caching). AuthCta/MobileMenu detect the session
// in the browser and correct themselves right after hydration.
export default function SiteNav() {
  const signedIn = false;

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
