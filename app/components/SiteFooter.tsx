import Link from "next/link";
import Logo from "./Logo";
import { createClient } from "@/lib/supabase/server";

export default async function SiteFooter() {
  const supabase = createClient();
  const { data } = await supabase
    .from("site_settings")
    .select("key, value")
    .in("key", ["support_telegram", "support_instagram", "support_whatsapp"]);
  const s = new Map((data ?? []).map((r) => [r.key, r.value as string]));
  const telegram = s.get("support_telegram") || "";
  const instagram = s.get("support_instagram") || "";
  const whatsapp = s.get("support_whatsapp") || "";

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
            Office: W 6/30, DLF Phase 3, Gurugram
          </p>
          <p className="muted" style={{ marginTop: 4, fontSize: ".82rem" }}>
            📧 <a className="grad" href="mailto:help@121caclasses.com">help@121caclasses.com</a>
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            {telegram && (
              <a href={telegram} target="_blank" rel="noopener noreferrer" className="btn small"
                style={{ background: "#229ED9", color: "#fff" }}>
                ✈️ Telegram
              </a>
            )}
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn small"
                style={{ background: "#25D366", color: "#fff" }}>
                💬 WhatsApp
              </a>
            )}
            {instagram && (
              <a href={instagram} target="_blank" rel="noopener noreferrer" className="btn small"
                style={{ background: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)", color: "#fff" }}>
                📸 Instagram
              </a>
            )}
          </div>
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
        &copy; 2026 121 CA Classes · 121caclasses.com · All rights reserved.
        <br />
        Site built by Dmeter Inc, Texas.
      </div>
    </footer>
  );
}
