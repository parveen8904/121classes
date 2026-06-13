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
