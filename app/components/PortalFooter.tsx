import { createClient } from "@/lib/supabase/server";

// Shared footer for every signed-in portal page (student + admin).
// Inspirational line + community/social links + brand credit.
export default async function PortalFooter() {
  const supabase = createClient();
  const { data } = await supabase
    .from("site_settings")
    .select("key, value")
    .in("key", ["support_telegram", "support_telegram_group", "support_discord", "support_whatsapp", "whatsapp_channel", "support_youtube", "support_instagram", "support_twitter", "support_facebook"]);
  const s = new Map((data ?? []).map((r) => [r.key, r.value as string]));

  const community: { href: string; label: string; bg: string }[] = [
    { href: s.get("support_telegram") || "", label: "✈️ Telegram channel", bg: "#229ED9" },
    { href: s.get("support_telegram_group") || "", label: "👥 Telegram group", bg: "#229ED9" },
    { href: s.get("support_discord") || "", label: "🎮 Discord", bg: "#5865F2" },
    { href: s.get("whatsapp_channel") || s.get("support_whatsapp") || "", label: "💬 WhatsApp", bg: "#25D366" },
  ].filter((x) => x.href);

  const socials: { href: string; label: string; emoji: string; bg: string }[] = [
    { href: s.get("support_youtube") || "", label: "YouTube", emoji: "▶️", bg: "#FF0000" },
    { href: s.get("support_instagram") || "", label: "Instagram", emoji: "📸", bg: "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)" },
    { href: s.get("support_twitter") || "", label: "X", emoji: "𝕏", bg: "#000000" },
    { href: s.get("support_facebook") || "", label: "Facebook", emoji: "f", bg: "#1877F2" },
  ].filter((x) => x.href);

  return (
    <footer className="portal-footer">
      <div className="portal-footer-inner">
        <p className="line">📚 Built with ❤️ for future Chartered Accountants — keep going, you&apos;ve got this! 🎯</p>

        {(community.length > 0 || socials.length > 0) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", alignItems: "center", margin: "10px 0 4px" }}>
            {community.map((c) => (
              <a key={c.label} href={c.href} target="_blank" rel="noopener noreferrer" className="btn small" style={{ background: c.bg, color: "#fff" }}>
                {c.label}
              </a>
            ))}
            {socials.map((sx) => (
              <a key={sx.label} href={sx.href} target="_blank" rel="noopener noreferrer" aria-label={sx.label} title={sx.label}
                style={{ width: 32, height: 32, borderRadius: "50%", background: sx.bg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: ".9rem", textDecoration: "none" }}>
                {sx.emoji}
              </a>
            ))}
          </div>
        )}

        <p className="sub">
          © 2026 CA Parveen Sharma 🙏 · Site by: Dmeter Inc.
        </p>
      </div>
      <div className="portal-strip" />
    </footer>
  );
}
