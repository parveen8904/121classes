import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import ImageUpload from "../_components/ImageUpload";
import SubmitButton from "@/app/components/SubmitButton";
import { updateSiteSettings, addTestimonial, deleteTestimonial } from "./actions";
import { saveHomepageIntroVideo, saveHomepageVideos, refreshHomepageThumbnails } from "../marketing/actions";

export default async function SiteImagesPage() {
  const { createServiceClient: svcT } = await import("@/lib/supabase/service");
  const { data: testimonialRows } = await svcT()
    .from("testimonials")
    .select("id, quote, student_name, reg_no, sort")
    .order("sort");
  const supabase = createClient();
  const { data } = await supabase.from("site_settings").select("key, value");
  const m = new Map((data ?? []).map((r) => [r.key, r.value as string | null]));

  // The channel's own uploads, so the homepage video is CHOSEN from a list of
  // thumbnails rather than by pasting a link and hoping it is the right one.
  const { getChannelOverview, getRecentVideos } = await import("@/lib/youtubeStats");
  const yt = await getChannelOverview().catch(() => null);
  const channelVideos = yt?.uploadsPlaylist ? await getRecentVideos(yt.uploadsPlaylist, 24).catch(() => []) : [];
  const introUrl = (m.get("intro_video_url") ?? "").trim();
  const introId = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/.exec(introUrl)?.[1] ?? "";

  // Which of those videos are pinned to the homepage row (up to 8).
  const ytV = m.get("homepage_yt_v") ?? "";
  let selectedIds: string[] = [];
  try {
    selectedIds = (JSON.parse(m.get("homepage_yt_videos") || "[]") as { id: string }[]).map((v) => v.id);
  } catch { /* nothing picked yet */ }

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

        <label htmlFor="gsv" style={{ marginTop: 14 }}>
          Google Search Console token
        </label>
        <input
          id="gsv"
          name="google_site_verification"
          defaultValue={m.get("google_site_verification") ?? ""}
          placeholder="paste only the content value, e.g. CaIsk_Q-Pudl5oxRxRCmeSo1Zu..."
        />
        <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>
          In Search Console choose <strong>HTML tag</strong> as the verification method and copy just the
          <code> content=&quot;…&quot;</code> value into this box. Save, wait a minute, then press Verify. This
          avoids DNS entirely — nothing at your domain registrar is touched, so your email records cannot be
          disturbed.
        </p>
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
            <label htmlFor="si-video">🎬 Homepage intro video — paste a link, or pick one below</label>
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

      {/* Pick the big homepage video from the channel — its own form, so it
          saves independently of the settings above. */}
      {channelVideos.length > 0 && (
        <div className="card" style={{ marginTop: 22 }}>
          <h3 style={{ marginTop: 0 }}>▶️ Choose the homepage video</h3>
          <p className="muted" style={{ fontSize: ".84rem", marginTop: 0 }}>
            This is the large video on the front page. Leave it on <strong>Latest upload</strong> and it always plays your
            newest video — or pin one here, so a class recording going up on YouTube never replaces your introduction.
          </p>
          <form action={saveHomepageIntroVideo}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
              <label className="remember" style={{ display: "block", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
                <input type="radio" name="intro_vid" value="latest" defaultChecked={!introId} /> <strong>Latest upload</strong>
                <div className="muted" style={{ fontSize: ".78rem", marginTop: 4 }}>Follows the channel automatically.</div>
              </label>
              {channelVideos.map((v) => (
                <label
                  key={v.id}
                  className="remember"
                  style={{ display: "block", border: `1px solid ${introId === v.id ? "var(--accent)" : "var(--border)"}`, borderRadius: 10, padding: 10 }}
                >
                  <input type="radio" name="intro_vid" value={v.id} defaultChecked={introId === v.id} />
                  <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" style={{ width: "100%", borderRadius: 8, marginTop: 6 }} />
                  <div style={{ fontSize: ".8rem", marginTop: 4 }}>{v.title}</div>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: ".82rem" }}>…or paste any YouTube link — including an UNLISTED video (unlisted uploads never appear in the tiles above)</label>
              <input name="intro_url" placeholder="https://www.youtube.com/watch?v=XXXX or https://youtu.be/XXXX" defaultValue="" />
            </div>
            <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginTop: 10 }}>Use this as the homepage video</SubmitButton>
          </form>
        </div>
      )}

      {/* Homepage YouTube curation — the homepage shows ONLY what's ticked here. */}
      <h2 className="admin-section-title" style={{ marginTop: 20 }}>🎬 Homepage YouTube videos</h2>
      <div className="card" style={{ marginTop: 10 }}>
        <p style={{ fontSize: ".9rem", marginTop: 0, fontWeight: 700 }}>
          {selectedIds.length === 0
            ? "Nothing ticked — the homepage is showing the latest 8 videos from your channel."
            : `${selectedIds.length} of 8 ticked — the homepage is showing exactly these ${selectedIds.length}.`}
        </p>
        <p className="muted" style={{ fontSize: ".84rem", marginTop: 0 }}>
          Tick <strong>up to 8</strong> videos — only these appear on the homepage (no view counts shown).
          If none are ticked, the latest 8 from the channel show automatically. Ticking more than 8 keeps the first 8, so the homepage row stays tidy.
        </p>
        <div className="card" style={{ marginBottom: 12, fontSize: ".84rem" }}>
          <strong>Changed a thumbnail on YouTube and the site still shows the old one?</strong>
          <p className="muted" style={{ margin: "4px 0 8px" }}>
            That is not the page being stale — a thumbnail keeps the same web address when you replace it, so browsers
            and the networks in between keep showing the copy they already have. This fetches them afresh everywhere.
          </p>
          <form action={refreshHomepageThumbnails} style={{ margin: 0 }}>
            <SubmitButton className="btn small" savedLabel="✓ Refreshed">🔄 Fetch new thumbnails</SubmitButton>
          </form>
        </div>
        {channelVideos.length > 0 ? (
          <form action={saveHomepageVideos}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
              {channelVideos.map((v) => (
                <label key={v.id} style={{ border: selectedIds.includes(v.id) ? "2px solid var(--accent)" : "1px solid var(--border)", borderRadius: 10, overflow: "hidden", cursor: "pointer", display: "block" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/yt-thumb/${v.id}${ytV ? `?v=${ytV}` : ""}`} alt={v.title} loading="lazy" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} />
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px" }}>
                    <input type="checkbox" name="vid" value={`${v.id}:::${v.title}`} defaultChecked={selectedIds.includes(v.id)} style={{ marginTop: 2 }} />
                    <span style={{ fontSize: ".8rem", fontWeight: 600, lineHeight: 1.25 }}>{v.title}</span>
                  </div>
                </label>
              ))}
            </div>
            <SubmitButton className="btn" savedLabel="✓ Homepage videos updated" style={{ marginTop: 12 }}>
              Save homepage videos
            </SubmitButton>
          </form>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Couldn&apos;t load the channel&apos;s videos right now — refresh in a minute.</p>
        )}
      </div>


      <p className="muted" style={{ fontSize: ".85rem", marginTop: 14 }}>
        💡 Export from Canva as <strong>PNG or JPG</strong>. The founder photo looks best as a portrait;
        the banner looks best wide (around 1600×500).
      </p>
      {/* ── Testimonials ─────────────────────────────────────────────── */}
      <div className="form-card" style={{ marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>💬 Testimonials on the homepage</h3>
        <p className="muted" style={{ fontSize: ".85rem", margin: "4px 0 12px" }}>
          Real students only — the registration number is what makes a quote checkable. The homepage shows them in
          the order below; with none entered, the section does not appear at all.
        </p>
        <form action={addTestimonial} style={{ display: "grid", gap: 10 }}>
          <textarea name="quote" rows={2} required placeholder="The quote, in the student's words" />
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "2fr 1fr 80px" }}>
            <input name="student_name" required placeholder="Student's name" />
            <input name="reg_no" placeholder="Registration no." />
            <input name="sort" type="number" defaultValue={((testimonialRows ?? []).length + 1) * 10} title="Order" />
          </div>
          <div><SubmitButton className="btn small">➕ Add testimonial</SubmitButton></div>
        </form>
        {(testimonialRows ?? []).length > 0 && (
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {(testimonialRows ?? []).map((t) => (
              <div className="list-row" key={t.id as string} style={{ flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="row-title">&ldquo;{(t.quote as string).slice(0, 90)}&rdquo;</span>
                  <p className="row-sub">{t.student_name as string}{t.reg_no ? ` · Reg. ${t.reg_no as string}` : ""} · order {t.sort as number}</p>
                </div>
                <form action={deleteTestimonial}>
                  <input type="hidden" name="id" value={t.id as string} />
                  <SubmitButton className="btn small secondary">Delete</SubmitButton>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
