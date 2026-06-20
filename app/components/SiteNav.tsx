import Link from "next/link";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import MobileMenu from "./MobileMenu";

const NAV_LINKS = [
  { href: "/courses", label: "Courses" },
  { href: "/test-series", label: "Test Series" },
  { href: "/results", label: "Results" },
  { href: "/books", label: "Books" },
  { href: "/resources", label: "Resources" },
  { href: "/#contact", label: "Contact" },
];

export default async function SiteNav() {
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
          <Link className="btn hide-sm" href="/login">
            Log in
          </Link>
          <MobileMenu links={NAV_LINKS} />
        </div>
      </div>
    </nav>
  );
}
