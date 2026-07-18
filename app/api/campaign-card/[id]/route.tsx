import { ImageResponse } from "next/og";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// 1080×1080 Instagram card, auto-generated from a scheduled post — part of the
// campaign pack (the prepare-and-remind email links here; admin Campaigns page
// has a download button). Addressed by the post's UUID (unguessable); the
// content is marketing copy that is about to be published anyway.

const CARDS = [
  { bg: "linear-gradient(135deg, #0d9488 0%, #115e59 100%)", chip: "#f0fdfa", chipText: "#115e59" },
  { bg: "linear-gradient(135deg, #134e4a 0%, #0d9488 60%, #2dd4bf 100%)", chip: "#ccfbf1", chipText: "#134e4a" },
  { bg: "linear-gradient(160deg, #042f2e 0%, #0f766e 100%)", chip: "#99f6e4", chipText: "#042f2e" },
];

function pickCard(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CARDS[h % CARDS.length];
}

// Clean the caption for display: drop hashtags/links (they belong in the
// caption, not on the graphic) and markdown leftovers.
function displayText(raw: string): { headline: string; lines: string[] } {
  const cleaned = raw
    .replace(/https?:\/\/\S+/g, "")
    .replace(/#[\w]+/g, "")
    .replace(/[*_`]+/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  const parts = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const headline = parts[0] ?? "CA Parveen Sharma";
  const rest = parts.slice(1).join(" ").split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3);
  return { headline: headline.slice(0, 120), lines: rest.map((l) => l.slice(0, 140)) };
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const wantJpeg = new URL(req.url).searchParams.get("fmt") === "jpg";
  const svc = createServiceClient();
  const { data: post } = await svc
    .from("scheduled_posts")
    .select("id, body, ig_text, campaign")
    .eq("id", params.id)
    .maybeSingle();
  if (!post) return new Response("Not found", { status: 404 });

  const { headline, lines } = displayText(String(post.ig_text || post.body || ""));
  const card = pickCard(post.id as string);
  const headSize = headline.length > 90 ? 52 : headline.length > 60 ? 62 : 74;

  const png = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: card.bg,
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top: brand + campaign chip */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2 }}>CA PARVEEN SHARMA</div>
            <div style={{ fontSize: 26, opacity: 0.85, marginTop: 4 }}>36 years of teaching · caparveensharma.com</div>
          </div>
          {post.campaign ? (
            <div
              style={{
                display: "flex",
                background: card.chip,
                color: card.chipText,
                borderRadius: 999,
                padding: "12px 28px",
                fontSize: 26,
                fontWeight: 700,
                maxWidth: 340,
              }}
            >
              {(() => {
                const c = String(post.campaign);
                if (c.length <= 26) return c;
                const cut = c.slice(0, 26);
                return cut.slice(0, cut.lastIndexOf(" ") > 8 ? cut.lastIndexOf(" ") : 26);
              })()}
            </div>
          ) : null}
        </div>

        {/* Middle: headline + supporting lines */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ fontSize: headSize, fontWeight: 700, lineHeight: 1.15, maxWidth: 936 }}>{headline}</div>
          {lines.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {lines.map((l, i) => (
                <div key={i} style={{ fontSize: 32, opacity: 0.92, lineHeight: 1.35, maxWidth: 936 }}>{l}</div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Bottom: CTA bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(255,255,255,0.14)",
            borderRadius: 20,
            padding: "26px 36px",
          }}
        >
          <div style={{ fontSize: 32, fontWeight: 700 }}>Start free → caparveensharma.com</div>
          <div style={{ fontSize: 30, opacity: 0.9 }}>CA Inter · CA Final</div>
        </div>
      </div>
    ),
    { width: 1080, height: 1080 },
  );

  // Instagram's Graph API only accepts JPEG image URLs — ?fmt=jpg converts.
  if (wantJpeg) {
    const sharp = (await import("sharp")).default;
    const buf = Buffer.from(await png.arrayBuffer());
    const jpeg = await sharp(buf).jpeg({ quality: 90 }).toBuffer();
    return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" } });
  }
  return png;
}
