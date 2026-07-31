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
