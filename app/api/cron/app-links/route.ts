import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyFaculty } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ARE THE DOWNLOAD LINKS STILL GOOD?
//
// Every one of these is quoted to students — on the homepage, on the install
// page, and now at the end of a conversation. They fail quietly: a moved file
// on R2, a store listing pulled for review, an installer replaced with a newer
// version while the advertised number stays behind. Nobody notices, because
// nobody clicks their own download link.
//
// Two of these had already gone wrong and neither had shown up anywhere:
//   • app_url_android was empty, so half of every "download our app" was blank;
//   • the update check advertised 2.0.0 while the installers served were 2.2.0,
//     so anyone on 2.1 was told they were current and never offered the newer
//     build.
//
// Once a day, therefore, each link is actually fetched, and the version we
// advertise is compared with the filename we are handing out.

const LINKS = [
  { key: "app_url_ios", what: "iPhone app (App Store)" },
  { key: "app_url_android", what: "Android app (Google Play)" },
  { key: "app_url_mac", what: "Mac installer" },
  { key: "app_url_windows", what: "Windows installer" },
];

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const { data } = await svc
    .from("site_settings")
    .select("key, value")
    .in("key", [...LINKS.map((l) => l.key), "app_latest_version"]);
  const set = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "").trim()]));

  const problems: string[] = [];
  const checked: { what: string; status: string }[] = [];

  for (const l of LINKS) {
    const url = set.get(l.key) ?? "";
    if (!url) {
      problems.push(`${l.what}: no link set at all — students are shown nothing.`);
      checked.push({ what: l.what, status: "missing" });
      continue;
    }
    try {
      // HEAD first: an installer is well over a hundred megabytes and there is
      // no reason to pull it every day to learn that it exists.
      let res = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (res.status === 405 || res.status === 403) {
        res = await fetch(url, { method: "GET", redirect: "follow", headers: { Range: "bytes=0-64" } });
      }
      if (!res.ok && res.status !== 206) {
        problems.push(`${l.what}: ${url} returned ${res.status}.`);
        checked.push({ what: l.what, status: String(res.status) });
      } else {
        checked.push({ what: l.what, status: "ok" });
      }
    } catch (e) {
      problems.push(`${l.what}: could not be reached — ${e instanceof Error ? e.message : "unknown error"}.`);
      checked.push({ what: l.what, status: "unreachable" });
    }
  }

  // The number we advertise against the file we actually serve. A mismatch here
  // means the update prompt is lying in one direction or the other.
  const advertised = set.get("app_latest_version") ?? "";
  for (const key of ["app_url_mac", "app_url_windows"]) {
    const url = set.get(key) ?? "";
    const inName = /(\d+\.\d+\.\d+)/.exec(url)?.[1];
    if (advertised && inName && inName !== advertised) {
      problems.push(
        `Version mismatch: we tell the app the latest is ${advertised}, but ${key} serves ${inName}. ` +
          `Anyone between the two is told they are up to date and never offered the newer build.`,
      );
    }
  }

  if (problems.length) {
    await notifyFaculty(
      "🔗 An app download link needs attention",
      `${problems.join("\n\n")}\n\nFix them in Admin → Site settings.`,
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true, checked, problems });
}
