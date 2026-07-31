import { createServiceClient } from "@/lib/supabase/service";
import { createZoomMeeting, endZoomMeeting, createZoomWebinar, endZoomWebinar } from "@/lib/zoom";

// Start/stop an interactive Zoom class from ANYWHERE — the admin portal
// button is the front door, so a class can begin from a phone or an iPad,
// not just one configured laptop.
//
// One click does everything the tech engineer used to: instant meeting with
// cloud recording FORCED ON (the recording.completed webhook then imports the
// file into Bunny and attaches it to the session), a published live session
// students join white-label on the site, and Telegram announcements to the
// channel + every subject group. The running meeting's id sits in
// site_settings so the End button works from any device too.

const RUNNING_KEY = "live_zoom_running"; // {meeting_id, session_id, title, start_url, started_at}

export type RunningClass = {
  kind?: "webinar" | "meeting";
  meeting_id: string;
  session_id: string | null;
  title: string;
  start_url: string;
  started_at: string;
};

async function readRunning(): Promise<RunningClass | null> {
  const { data } = await createServiceClient().from("site_settings").select("value").eq("key", RUNNING_KEY).maybeSingle();
  try { return data?.value ? (JSON.parse(data.value as string) as RunningClass) : null; } catch { return null; }
}
async function writeRunning(v: RunningClass | null): Promise<void> {
  await createServiceClient().from("site_settings").upsert({ key: RUNNING_KEY, value: v ? JSON.stringify(v) : "" }, { onConflict: "key" });
}

export async function getRunningClass(): Promise<RunningClass | null> {
  const r = await readRunning();
  return r?.meeting_id ? r : null;
}

export async function startZoomClass(titleRaw?: string): Promise<{ ok: true; running: RunningClass } | { ok: false; error: string }> {
  const already = await getRunningClass();
  if (already) return { ok: true, running: already }; // idempotent — pressing twice never makes two classes

  const title = (titleRaw ?? "").trim().slice(0, 120) || "Live class";
  // Webinar first (his format of choice); plain meeting as the fallback so a
  // licence hiccup can never cancel a class.
  let kind: "webinar" | "meeting" = "webinar";
  let meeting = await createZoomWebinar(title, { autoRecordCloud: true });
  if (!meeting) { kind = "meeting"; meeting = await createZoomMeeting(title, "", 120, { autoRecordCloud: true }); }
  if (!meeting) return { ok: false, error: "Zoom did not create the class — check the Zoom server keys." };

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

  const running: RunningClass = {
    kind,
    meeting_id: meeting.id,
    session_id: (session?.id as string) ?? null,
    title,
    start_url: meeting.start_url,
    started_at: new Date().toISOString(),
  };
  await writeRunning(running);

  // Announce — best effort, never blocks the class.
  try {
    const { sendTelegramChannel } = await import("@/lib/notify");
    const link = running.session_id ? `caparveensharma.com/live/join/${running.session_id}` : "caparveensharma.com/live";
    const msg = `🔴 LIVE now: ${title}\n\nJoin at ${link} — log in and you're in.`;
    await sendTelegramChannel(msg).catch(() => false);
    const { tgSendToGroup } = await import("@/lib/telegramGroup");
    const { data: subs } = await svc.from("subjects").select("telegram_group_chat_id").not("telegram_group_chat_id", "is", null);
    for (const s of subs ?? []) await tgSendToGroup(String(s.telegram_group_chat_id), msg).catch(() => false);
  } catch { /* class > notification */ }

  return { ok: true, running };
}

export async function stopZoomClass(): Promise<{ ok: true }> {
  const running = await getRunningClass();
  if (running) {
    if (running.kind === "webinar") await endZoomWebinar(running.meeting_id).catch(() => false);
    else await endZoomMeeting(running.meeting_id).catch(() => false);
    try {
      const { sendTelegramChannel } = await import("@/lib/notify");
      await sendTelegramChannel("✅ Today's live class has ended. The recording will appear on the portal automatically.").catch(() => false);
    } catch { /* best effort */ }
  }
  await writeRunning(null);
  return { ok: true };
}
