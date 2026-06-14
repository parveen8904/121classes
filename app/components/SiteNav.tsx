import Link from "next/link";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";
import MobileMenu from "./MobileMenu";

const NAV_LINKS = [
  { href: "/courses", label: "Courses" },
  { href: "/combos", label: "Combos" },
  { href: "/test-series", label: "Test Series" },
  { href: "/results", label: "Results" },
  { href: "/faculty", label: "Faculty" },
  { href: "/books", label: "Books" },
  { href: "/#contact", label: "Contact" },
];

export default function SiteNav() {
  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <Link href="/" aria-label="121 CA Classes home" className="lp-brand">
          <Logo />
          <span className="lp-tagline">Personalised one-on-one learning</span>
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
