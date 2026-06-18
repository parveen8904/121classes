import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import ImageUpload from "../_components/ImageUpload";
import { updateSiteSettings } from "./actions";

export default async function SiteImagesPage() {
  const supabase = createClient();
  const { data } = await supabase.from("site_settings").select("key, value");
  const m = new Map((data ?? []).map((r) => [r.key, r.value as string | null]));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <AdminHero
        badge="🖼️ Site images"
        title="Homepage images"
        subtitle="Upload your founder photo and homepage banner — they appear on the public homepage instantly. 🎨"
        back={{ href: "/admin", label: "Admin" }}
      />

      <form action={updateSiteSettings} className="form-card" style={{ marginTop: 24 }}>
        <ImageUpload
          name="logo_url"
          defaultValue={m.get("logo_url") ?? ""}
          folder="site"
          label="Brand logo (appears in the header & footer on every page) — PNG, ideally transparent, wide"
        />
        <div style={{ marginTop: 18 }} />
        <ImageUpload
          name="founder_photo"
          defaultValue={m.get("founder_photo") ?? ""}
          folder="site"
          label="Founder photo (CA Parveen Sharma)"
        />
        <div style={{ marginTop: 18 }}>
          <ImageUpload
            name="hero_banner"
            defaultValue={m.get("hero_banner") ?? ""}
            folder="site"
            label="Homepage banner (wide image)"
          />
        </div>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 18 }}>
          <div>
            <label>📱 WhatsApp number (for the support button)</label>
            <input name="support_whatsapp" defaultValue={m.get("support_whatsapp") ?? ""} placeholder="e.g. 919812345678" />
          </div>
          <div>
            <label>📞 Phone number (for the call button)</label>
            <input name="support_phone" defaultValue={m.get("support_phone") ?? ""} placeholder="e.g. 919812345678" />
          </div>
          <div>
            <label>✈️ Telegram channel link (for the Telegram button)</label>
            <input name="support_telegram" defaultValue={m.get("support_telegram") ?? ""} placeholder="e.g. https://t.me/caparveen" />
          </div>
        </div>

        <h3 style={{ marginTop: 24, marginBottom: 4 }}>📲 App download links (landing page)</h3>
        <p className="muted" style={{ fontSize: ".82rem", marginBottom: 10 }}>
          Paste each link as the app becomes available. Blank = the button shows &ldquo;Coming soon&rdquo;.
        </p>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>🌐 Web app URL</label>
            <input name="app_url_web" defaultValue={m.get("app_url_web") ?? ""} placeholder="/login" />
          </div>
          <div>
            <label>🍎 Mac app (.dmg) URL</label>
            <input name="app_url_mac" defaultValue={m.get("app_url_mac") ?? ""} placeholder="https://…/app.dmg" />
          </div>
          <div>
            <label>🪟 Windows app (.exe) URL</label>
            <input name="app_url_windows" defaultValue={m.get("app_url_windows") ?? ""} placeholder="https://…/app.exe" />
          </div>
          <div>
            <label>📱 iPhone App Store URL</label>
            <input name="app_url_ios" defaultValue={m.get("app_url_ios") ?? ""} placeholder="https://apps.apple.com/…" />
          </div>
          <div>
            <label>🤖 Android Play Store URL</label>
            <input name="app_url_android" defaultValue={m.get("app_url_android") ?? ""} placeholder="https://play.google.com/…" />
          </div>
        </div>

        <button className="btn" type="submit" style={{ marginTop: 18 }}>
          Save
        </button>
      </form>

      <p className="muted" style={{ fontSize: ".85rem", marginTop: 14 }}>
        💡 Export from Canva as <strong>PNG or JPG</strong>. The founder photo looks best as a portrait;
        the banner looks best wide (around 1600×500).
      </p>
    </section>
  );
}
