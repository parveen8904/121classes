import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// GET /api/app/version — the desktop app calls this on launch to learn the
// latest installer version + download URLs. Returns plain JSON (no auth).
export async function GET() {
  const keys = ["app_latest_version", "app_url_mac", "app_url_windows", "app_update_notes"];
  let settings: Record<string, string> = {};
  try {
    const svc = createServiceClient();
    const { data } = await svc.from("site_settings").select("key, value").in("key", keys);
    settings = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  } catch {
    /* fall through to empty defaults */
  }

  return NextResponse.json(
    {
      version: settings.app_latest_version ?? "0.0.0",
      mac: settings.app_url_mac ?? "",
      windows: settings.app_url_windows ?? "",
      notes: settings.app_update_notes ?? "",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
