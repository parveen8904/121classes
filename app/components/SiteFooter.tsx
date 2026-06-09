import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <div>
          <div className="logo">121<span>Coaching</span></div>
          <p className="muted" style={{ marginTop: 10, fontSize: ".9rem", maxWidth: 320 }}>
            1-to-1 classes, live coaching, ad-free recorded lectures and AI-assisted
            learning for CA students.
          </p>
          <p className="muted" style={{ marginTop: 14, fontSize: ".82rem" }}>
            Office: W 6/30, DLF, Gurugram
          </p>
        </div>
        <div>
          <h4>Explore</h4>
          <Link href="/#courses">Courses</Link>
          <Link href="/#books">Books</Link>
          <Link href="/#resources">Resources</Link>
          <Link href="/#whats-new">What&apos;s New</Link>
          <Link href="/#team">Team</Link>
        </div>
        <div>
          <h4>Company</h4>
          <Link href="/#about">About Us</Link>
          <Link href="/#vision">Vision</Link>
          <Link href="/#contact">Contact Us</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/refund">Refund Policy</Link>
        </div>
      </div>
      <div className="copy">
        &copy; 2026 121 Coaching · 121coaching.ai · All rights reserved.
      </div>
    </footer>
  );
}
