import Link from "next/link";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

export default function SiteNav() {
  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <Link href="/" aria-label="121 CA Classes home">
          <Logo />
        </Link>
        <div className="lp-nav-links">
          <Link className="hide-sm" href="/#courses">Courses</Link>
          <Link className="hide-sm" href="/#books">Books</Link>
          <Link className="hide-sm" href="/#resources">Resources</Link>
          <Link className="hide-sm" href="/#about">About</Link>
          <Link className="hide-sm" href="/#contact">Contact</Link>
          <ThemeToggle />
          <Link className="btn" href="/login">Log in</Link>
        </div>
      </div>
    </nav>
  );
}
