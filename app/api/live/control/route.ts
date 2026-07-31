import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { goLive, endLive, getLiveState } from "@/lib/liveStream";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The founder's Desktop scripts drive this. One key (LIVE_CONTROL_KEY),
// three actions:
//   ?action=start[&title=…] → creates/reuses the Cloudflare live input, flips
//     the site to LIVE, notifies students, returns the RTMPS target OBS needs.
//   ?action=stop  → flips the site back, announces the end.
//   ?action=status → current state (used by the scripts to be idempotent).
export async function GET(req: NextRequest) {
  const key = (await getSecret("LIVE_CONTROL_KEY")).trim();
  const params = new URL(req.url).searchParams;
  if (!key || params.get("key") !== key) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const action = params.get("action") ?? "status";

  // mode=zoom: the interactive path. Creates an instant Zoom meeting with
  // cloud recording ON (the recording webhook later lands it in Bunny),
  // publishes it as a live session students join white-label on the site,
  // announces it, and hands the host start URL back to the Desktop script.
  if (action === "start" && params.get("mode") === "zoom") {
    const { createZoomMeeting } = await import("@/lib/zoom");
    const title = (params.get("title") ?? "Live class").slice(0, 120);
    const meeting = await createZoomMeeting(title, "", 120, { autoRecordCloud: true });
    if (!meeting) return NextResponse.json({ ok: false, error: "Zoom refused — are the Zoom server keys configured?" }, { status: 502 });

    const { createServiceClient } = await import("@/lib/supabase/service");
    const svc = createServiceClient();
    const { data: session } = await svc.from("live_sessions").insert({
      title,
      starts_at: new Date().toISOString(),
      duration_mins: 120,
      join_url: meeting.join_url,
      zoom_meeting_number: meeting.id.replace(/\D/g, "") || null,
      zoom_passcode: meeting.passcode || null,
      is_published: true,
    }).select("id").maybeSingle();

    try {
      const { sendTelegramChannel } = await import("@/lib/notify");
      const link = session?.id ? `caparveensharma.com/live/join/${session.id}` : "caparveensharma.com/live";
      const msg = `🔴 LIVE now on Zoom: ${title}\n\nJoin at ${link} — log in and you're in.`;
      await sendTelegramChannel(msg).catch(() => false);
      const { tgSendToGroup } = await import("@/lib/telegramGroup");
      const { data: subs } = await svc.from("subjects").select("telegram_group_chat_id").not("telegram_group_chat_id", "is", null);
      for (const s of subs ?? []) await tgSendToGroup(String(s.telegram_group_chat_id), msg).catch(() => false);
    } catch { /* never block going live on a notification */ }

    return NextResponse.json({ ok: true, mode: "zoom", start_url: meeting.start_url, meeting_id: meeting.id, session_id: session?.id ?? null });
  }
  if (action === "stop" && params.get("meeting_id")) {
    const { endZoomMeeting } = await import("@/lib/zoom");
    await endZoomMeeting(params.get("meeting_id") ?? "");
    const { endLive } = await import("@/lib/liveStream");
    await endLive();
    return NextResponse.json({ ok: true, stopped: true, mode: "zoom" });
  }

  if (action === "start") {
    const r = await goLive(params.get("title") ?? undefined);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true, rtmps_url: r.rtmpsUrl, stream_key: r.streamKey, watch_url: r.watchUrl });
  }
  if (action === "stop") {
    await endLive();
    return NextResponse.json({ ok: true, stopped: true });
  }
  return NextResponse.json({ ok: true, state: await getLiveState() });
}
