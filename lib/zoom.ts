// Zoom Server-to-Server OAuth integration — SERVER-ONLY. Optional: when the
// keys are absent the admin just pastes a join link manually.

export function zoomConfigured(): boolean {
  return Boolean(
    process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET,
  );
}

async function getToken(): Promise<string | null> {
  try {
    const basic = Buffer.from(
      `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`,
    ).toString("base64");
    const res = await fetch(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${basic}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

// Create a scheduled meeting. `startLocal` is a datetime-local string
// ("2026-07-01T18:00"); we treat it as Asia/Kolkata. Returns join_url + id.
export async function createZoomMeeting(
  topic: string,
  startLocal: string,
  durationMins = 60,
  opts: { autoRecordCloud?: boolean } = {},
): Promise<{ join_url: string; start_url: string; id: string; passcode: string } | null> {
  if (!zoomConfigured()) return null;
  const token = await getToken();
  if (!token) return null;
  try {
    const body: Record<string, unknown> = {
      topic: topic.slice(0, 200),
      type: startLocal ? 2 : 1, // 2 = scheduled, 1 = instant
      duration: durationMins,
      timezone: "Asia/Kolkata",
      settings: {
        join_before_host: true,
        waiting_room: false,
        // Cloud recording from the first second, nobody has to remember to
        // press record — the recording.completed webhook then imports the
        // file into Bunny and attaches it to the class.
        ...(opts.autoRecordCloud ? { auto_recording: "cloud" } : {}),
      },
    };
    if (startLocal) body.start_time = `${startLocal}:00`;

    const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.join_url) return null;
    return { join_url: data.join_url, start_url: String(data.start_url ?? data.join_url), id: String(data.id ?? ""), passcode: String(data.password ?? "") };
  } catch {
    return null;
  }
}

// End a running meeting from the server — the "⏹ End Class" button calls this
// so the founder never hunts for Zoom's own end button.
export async function endZoomMeeting(meetingId: string): Promise<boolean> {
  if (!zoomConfigured() || !meetingId) return false;
  const token = await getToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/status`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
