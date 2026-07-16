import { createClient } from "@/lib/supabase/server";
import SocialLinks from "./SocialLinks";

// Shared footer for every signed-in portal page (student + admin).
// Inspirational line + social links + brand credit.
export default async function PortalFooter() {
  const supabase = createClient();
  const { data } = await supabase
    .from("site_settings")
    .select("key, value")
    .in("key", ["support_youtube", "support_instagram", "support_twitter", "support_facebook"]);
  const s = new Map((data ?? []).map((r) => [r.key, r.value as string]));
  const youtube = s.get("support_youtube") || "";
  const instagram = s.get("support_instagram") || "";
  const twitter = s.get("support_twitter") || "";
  const facebook = s.get("support_facebook") || "";
  const hasSocials = !!(youtube || instagram || twitter || facebook);

  return (
    <footer className="portal-footer">
      <div className="portal-footer-inner">
        <p className="line">📚 Built with ❤️ for future Chartered Accountants — keep going, you&apos;ve got this! 🎯</p>

        {hasSocials && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", alignItems: "center", margin: "10px 0 4px" }}>
            <SocialLinks youtube={youtube} instagram={instagram} twitter={twitter} facebook={facebook} size={32} />
          </div>
        )}

        <p className="sub" style={{ marginBottom: 4 }}>
          <a href="/guide" style={{ marginRight: 12 }}>📖 How to use the portal</a>
          <a href="/support">🎧 Help &amp; support</a>
        </p>
        <p className="sub">
          © 2026 CA Parveen Sharma 🙏 · Site by: Dmeter Inc.
        </p>
      </div>
      <div className="portal-strip" />
    </footer>
  );
}
