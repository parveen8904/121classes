import Link from "next/link";
import BackButton from "./BackButton";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import MobileMenu from "./MobileMenu";
import AuthCta from "./AuthCta";

const NAV_LINKS = [
  { href: "/courses", label: "Courses" },
  { href: "/pricing", label: "Pricing" },
  { href: "/build-your-plan", label: "Planner" },
  { href: "/results", label: "Results" },
  { href: "/books", label: "Books" },
  { href: "/startups", label: "Startups" },
  { href: "/placements", label: "Career" },
  { href: "/#contact", label: "Contact" },
];

const MENU_ONLY_LINKS: { href: string; label: string }[] = [];

// No server-side auth read here — reading cookies would force every marketing
// page to render dynamically (no caching). AuthCta/MobileMenu detect the session
// in the browser and correct themselves right after hydration.
// prefetch={false} throughout. This nav is on every marketing page, and
// Next.js fetches each <Link> as it scrolls into view — so one visitor opening
// the homepage quietly pulled the whole site: Pricing, Courses, Results,
// Startups, Placements and the rest, whether or not they went there. That is
// what turned ordinary student traffic into a fifteen-fold jump in requests.
// Hover and touch still prefetch, so a link someone actually reaches for is
// still instant.
export default function SiteNav() {
  const signedIn = false;

  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <BackButton />
        <Link prefetch={false} href="/" aria-label="CA Parveen Sharma home" className="lp-brand">
          <Logo />
        </Link>
        </span>
        <div className="lp-nav-links">
          {NAV_LINKS.map((l) => (
            <Link prefetch={false} key={l.href} className="hide-sm" href={l.href}>
              {l.label}
            </Link>
          ))}
          <ThemeToggle />
          <AuthCta initialSignedIn={signedIn} />
          <MobileMenu links={[...NAV_LINKS, ...MENU_ONLY_LINKS]} initialSignedIn={signedIn} />
        </div>
      </div>
    </nav>
  );
}
