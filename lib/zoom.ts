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
): Promise<{ join_url: string; id: string } | null> {
  if (!zoomConfigured()) return null;
  const token = await getToken();
  if (!token) return null;
  try {
    const body: Record<string, unknown> = {
      topic: topic.slice(0, 200),
      type: startLocal ? 2 : 1, // 2 = scheduled, 1 = instant
      duration: durationMins,
      timezone: "Asia/Kolkata",
      settings: { join_before_host: true, waiting_room: false },
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
    return { join_url: data.join_url, id: String(data.id ?? "") };
  } catch {
    return null;
  }
}
