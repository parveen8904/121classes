import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { bunnyImportFromUrl, bunnyEmbedUrl } from "@/lib/bunny";

export const dynamic = "force-dynamic";

// Zoom "recording.completed" webhook → auto-import the cloud recording into Bunny
// and attach it to the matching live class (so the live class becomes a recorded
// class with no manual upload). Set ZOOM_WEBHOOK_SECRET_TOKEN in Admin → Integrations,
// and point the Zoom app's webhook at  https://caparveensharma.com/api/zoom/recording
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = await getSecret("ZOOM_WEBHOOK_SECRET_TOKEN");
  let body: any;
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad json", { status: 400 }); }

  // Zoom URL-validation handshake — respond with the HMAC of the plainToken.
  if (body?.event === "endpoint.url_validation") {
    if (!secret) return new NextResponse("not configured", { status: 500 });
    const plainToken = body?.payload?.plainToken ?? "";
    const encryptedToken = crypto.createHmac("sha256", secret).update(plainToken).digest("hex");
    return NextResponse.json({ plainToken, encryptedToken });
  }

  // Verify the signature on real events.
  if (secret) {
    const ts = req.headers.get("x-zm-request-timestamp") ?? "";
    const sig = req.headers.get("x-zm-signature") ?? "";
    const expected = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
    if (sig !== expected) return new NextResponse("bad signature", { status: 401 });
  }

  if (body?.event !== "recording.completed") return NextResponse.json({ ok: true });

  const obj = body?.payload?.object ?? {};
  const meetingId = String(obj.id ?? "").trim();
  const downloadToken = body?.download_token ?? "";
  const files: any[] = Array.isArray(obj.recording_files) ? obj.recording_files : [];
  // Prefer the combined speaker+screen MP4; otherwise any MP4.
  const mp4 = files.find((f) => f.file_type === "MP4" && f.recording_type === "shared_screen_with_speaker_view")
    || files.find((f) => f.file_type === "MP4");
  if (!meetingId || !mp4?.download_url) return NextResponse.json({ ok: true });

  const downloadUrl = downloadToken ? `${mp4.download_url}?access_token=${downloadToken}` : mp4.download_url;
  const svc = createServiceClient();

  // Match the meeting to a topic live-class section first…
  const { data: secs } = await svc.from("sections").select("id, title, config").eq("type", "live_class");
  const sec = (secs ?? []).find((s) => String((s.config as any)?.join_url ?? "").includes(meetingId));
  if (sec) {
    const guid = await bunnyImportFromUrl(sec.title || obj.topic || "Live class recording", downloadUrl);
    if (guid) {
      const cfg = (sec.config ?? {}) as Record<string, unknown>;
      await svc.from("sections").update({ config: { ...cfg, bunny_video_id: guid, bunny_drm: "off" } }).eq("id", sec.id);
    }
    return NextResponse.json({ ok: true, attached: "section" });
  }

  // …otherwise a standalone live session.
  const { data: lss } = await svc.from("live_sessions").select("id, title, join_url").not("join_url", "is", null);
  const ls = (lss ?? []).find((l) => String(l.join_url ?? "").includes(meetingId));
  if (ls) {
    const guid = await bunnyImportFromUrl(ls.title || obj.topic || "Live class recording", downloadUrl);
    if (guid) await svc.from("live_sessions").update({ recording_url: bunnyEmbedUrl(guid, false) }).eq("id", ls.id);
    return NextResponse.json({ ok: true, attached: "live_session" });
  }

  return NextResponse.json({ ok: true, attached: "none" });
}
