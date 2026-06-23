import Link from "next/link";
import Logo from "./Logo";
import { createClient } from "@/lib/supabase/server";

export default async function SiteFooter() {
  const supabase = createClient();
  const { data } = await supabase
    .from("site_settings")
    .select("key, value")
    .in("key", ["support_telegram", "support_discord", "support_instagram", "support_whatsapp", "support_youtube", "support_twitter", "support_facebook"]);
  const s = new Map((data ?? []).map((r) => [r.key, r.value as string]));
  const telegram = s.get("support_telegram") || "";
  const discord = s.get("support_discord") || "";
  const instagram = s.get("support_instagram") || "";
  const whatsapp = s.get("support_whatsapp") || "";
  const youtube = s.get("support_youtube") || "";
  const twitter = s.get("support_twitter") || "";
  const facebook = s.get("support_facebook") || "";
  const socials: { href: string; label: string; emoji: string; bg: string }[] = [
    { href: youtube, label: "YouTube", emoji: "▶️", bg: "#FF0000" },
    { href: instagram, label: "Instagram", emoji: "📸", bg: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)" },
    { href: twitter, label: "X", emoji: "𝕏", bg: "#000000" },
    { href: facebook, label: "Facebook", emoji: "f", bg: "#1877F2" },
  ].filter((x) => x.href);

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
            📧 <a className="grad" href="mailto:mail@caparveensharma.com">mail@caparveensharma.com</a>
          </p>
          {/* Community — join & chat */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            {telegram && (
              <a href={telegram} target="_blank" rel="noopener noreferrer" className="btn small"
                style={{ background: "#229ED9", color: "#fff" }}>
                ✈️ Telegram
              </a>
            )}
            {discord && (
              <a href={discord} target="_blank" rel="noopener noreferrer" className="btn small"
                style={{ background: "#5865F2", color: "#fff" }}>
                🎮 Discord
              </a>
            )}
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn small"
                style={{ background: "#25D366", color: "#fff" }}>
                💬 WhatsApp
              </a>
            )}
          </div>
          {/* Social media */}
          {socials.length > 0 && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: ".8rem" }}>Follow us:</span>
              {socials.map((sx) => (
                <a key={sx.label} href={sx.href} target="_blank" rel="noopener noreferrer" aria-label={sx.label} title={sx.label}
                  style={{ width: 34, height: 34, borderRadius: "50%", background: sx.bg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: ".95rem", textDecoration: "none" }}>
                  {sx.emoji}
                </a>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4>Explore</h4>
          <Link href="/#courses">Courses</Link>
          <Link href="/#books">Books</Link>
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
