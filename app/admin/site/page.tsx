import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import ImageUpload from "../_components/ImageUpload";
import SubmitButton from "@/app/components/SubmitButton";
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
          defaultValue={m.get("logo_url") ?? "/logo-121.png"}
          folder="site"
          label="Brand logo (header & footer on every page) — PNG, ideally transparent, wide"
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
        <div style={{ marginTop: 18 }}>
          <ImageUpload
            name="studio_photo"
            defaultValue={m.get("studio_photo") ?? ""}
            folder="site"
            label="Studio photo (CA Parveen Sharma teaching — shown in the 'Studio-quality teaching' section)"
          />
        </div>

        <h3 style={{ marginTop: 24, marginBottom: 4 }}>🎉 Pop-up banner (dynamic)</h3>
        <p className="muted" style={{ fontSize: ".82rem", marginBottom: 10 }}>
          A creative/banner image that pops up when someone opens the site, then disappears on its own.
          Leave blank for no pop-up.
        </p>
        <ImageUpload
          name="splash_banner"
          defaultValue={m.get("splash_banner") ?? ""}
          folder="site"
          label="Pop-up banner image"
        />
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
          <div>
            <label>Auto-close after (seconds)</label>
            <input name="splash_seconds" type="number" min={2} max={20} defaultValue={m.get("splash_seconds") ?? "5"} />
          </div>
          <div>
            <label>Link when clicked (optional)</label>
            <input name="splash_link" defaultValue={m.get("splash_link") ?? ""} placeholder="https://… or /courses" />
          </div>
        </div>
        <h3 style={{ marginTop: 24, marginBottom: 4 }}>📲 Community channels</h3>
        <p className="muted" style={{ fontSize: ".82rem", marginBottom: 10 }}>
          Students see these on their dashboard. The Telegram <strong>channel</strong> is your broadcast for general
          info; the per-subject Telegram <strong>groups</strong> are set on each subject (only that subject&apos;s
          students see them).
        </p>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 4 }}>
          <div style={{ marginTop: 18 }}>
            <label htmlFor="si-video">🎬 Homepage intro video (YouTube link or embed URL)</label>
            <input id="si-video" name="intro_video_url" defaultValue={m.get("intro_video_url") ?? ""} placeholder="e.g. https://www.youtube.com/watch?v=XXXX — shown in the 'Studio-quality teaching' section" />
          </div>
          <div>
            <label>💬 Technical-team WhatsApp (Admin)</label>
            <input name="support_whatsapp" defaultValue={m.get("support_whatsapp") ?? ""} placeholder="e.g. 919812345678 or https://wa.me/91…" />
          </div>
          <div>
            <label>👩‍🏫 Faculty-team WhatsApp</label>
            <input name="whatsapp_faculty" defaultValue={m.get("whatsapp_faculty") ?? ""} placeholder="e.g. 919812345678 or https://wa.me/91…" />
          </div>
          <div>
            <label>✈️ Telegram channel (general info — students subscribe)</label>
            <input name="support_telegram" defaultValue={m.get("support_telegram") ?? ""} placeholder="e.g. https://t.me/caparveen" />
          </div>
          <div>
            <label>📞 Phone number (for the call button)</label>
            <input name="support_phone" defaultValue={m.get("support_phone") ?? ""} placeholder="e.g. 919812345678" />
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

        <SubmitButton className="btn" style={{ marginTop: 18 }}>
          Save
        </SubmitButton>
      </form>

      <p className="muted" style={{ fontSize: ".85rem", marginTop: 14 }}>
        💡 Export from Canva as <strong>PNG or JPG</strong>. The founder photo looks best as a portrait;
        the banner looks best wide (around 1600×500).
      </p>
    </section>
  );
}
