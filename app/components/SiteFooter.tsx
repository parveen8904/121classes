import Link from "next/link";
import Logo from "./Logo";
import SocialLinks from "./SocialLinks";
import { tryServiceClient } from "@/lib/supabase/service";

export default async function SiteFooter() {
  // Service client (no cookies) — the footer only reads public site_settings,
  // and reading cookies here would force every marketing page to skip the cache.
  const supabase = tryServiceClient();
  const { data } = supabase
    ? await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", ["support_instagram", "support_youtube", "support_twitter", "support_facebook"])
    : { data: [] as { key: string; value: string }[] };
  const s = new Map((data ?? []).map((r) => [r.key, r.value as string]));
  const instagram = s.get("support_instagram") || "";
  const youtube = s.get("support_youtube") || "";
  const twitter = s.get("support_twitter") || "";
  const facebook = s.get("support_facebook") || "";
  const hasSocials = !!(instagram || youtube || twitter || facebook);

  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <div>
          <Logo />
          <p className="muted" style={{ marginTop: 10, fontSize: ".9rem", maxWidth: 320 }}>
            1-to-1 classes, live coaching, ad-free recorded lectures and AI-assisted
            learning for CA students.
          </p>
          <p className="muted" style={{ marginTop: 12, fontSize: ".85rem" }}>
            A venture by <strong>CA Parveen Sharma</strong>.
          </p>
          <p className="muted" style={{ marginTop: 8, fontSize: ".82rem" }}>
            Office: W6 Sector 24, DLF Phase 3, Gurugram 122010
          </p>
          <p className="muted" style={{ marginTop: 4, fontSize: ".82rem" }}>
            📧 <a className="grad" href="mailto:contact@caparveensharma.com">contact@caparveensharma.com</a>
          </p>
          {/* Social media */}
          {hasSocials && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: ".8rem" }}>Follow us:</span>
              <SocialLinks youtube={youtube} instagram={instagram} twitter={twitter} facebook={facebook} />
            </div>
          )}
        </div>
        <div>
          <h4>Explore</h4>
          <Link href="/#courses">Courses</Link>
          <Link href="/articles">Study Articles</Link>
          <Link href="/#books">Books</Link>
          <Link href="/#whats-new">What&apos;s New</Link>
        </div>
        <div>
          <h4>Company</h4>
          <Link href="/#about">About Us</Link>
          <Link href="/#vision">Vision</Link>
          <Link href="/#contact">Contact Us</Link>
          <Link href="/support">Help &amp; Support</Link>
          <Link href="/guide">Student Guide</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/refund">Refund Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </div>
      </div>
      <div className="copy">
        &copy; 2026 CA Parveen Sharma · caparveensharma.com · All rights reserved.
        <br />
        Site by: Dmeter Inc.
      </div>
    </footer>
  );
}
