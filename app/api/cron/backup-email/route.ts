import { NextResponse, type NextRequest } from "next/server";
import { gzipSync, gunzipSync } from "node:zlib";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmailWithAttachment, emailShell } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The weekly copy that leaves the building.
//
// A backup sitting in the same Supabase project it protects is half a backup:
// it survives a delete, not a lost account. The founder declined the paid
// point-in-time service and asked for the file to be zipped and emailed
// instead — which is the right instinct, because a copy in his own inbox is
// offline, outside this system, and needs nobody's permission to open.
//
// Gzipped, because the file is almost entirely text and compresses to a
// fraction of its size. Anything still too large for mail is reported rather
// than silently dropped, and the six-hourly copy in storage is unaffected.

const FOLDER = "backups";
const MAIL_LIMIT_MB = 20;

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // Send the most recent six-hourly copy rather than taking a fresh one — it
  // is the same content and nothing is duplicated.
  const { data: files } = await svc.storage.from("secure").list(FOLDER, { limit: 500 });
  const latest = (files ?? [])
    .map((f) => f.name)
    .filter((n) => n.startsWith("backup-"))
    .sort()
    .pop();
  if (!latest) return NextResponse.json({ ok: false, error: "no backup file to send yet" }, { status: 404 });

  const { data: blob, error } = await svc.storage.from("secure").download(`${FOLDER}/${latest}`);
  if (error || !blob) return NextResponse.json({ ok: false, error: error?.message ?? "download failed" }, { status: 500 });

  // The six-hourly copy is stored gzipped now, so it is attached as it is —
  // gzipping a gzip only makes it bigger.
  const stored = Buffer.from(await blob.arrayBuffer());
  const alreadyGz = latest.endsWith(".gz");
  const zipped = alreadyGz ? stored : gzipSync(stored, { level: 9 });
  const rawMB = (alreadyGz ? gunzipSync(stored).length : stored.length) / 1048576;
  const zipMB = zipped.length / 1048576;

  const to =
    (await getSecret("BACKUP_EMAIL")) ||
    (await getSecret("NOTIFY_REPLY_TO")) ||
    "";
  if (!to) return NextResponse.json({ ok: false, error: "set BACKUP_EMAIL in Admin → Integrations" }, { status: 400 });

  const summary =
    `<p>Weekly backup of caparveensharma.com.</p>` +
    `<p><strong>${latest}</strong><br/>` +
    `Uncompressed ${rawMB.toFixed(1)} MB · attached ${zipMB.toFixed(1)} MB (gzip)</p>` +
    `<p>This file holds the answer keys, marking schemes, teaching content, question banks and student ` +
    `attempts — everything that cannot be re-created by re-running something. Keep it somewhere outside ` +
    `this mailbox as well.</p>` +
    `<p class="muted">To restore from it, send the file back to your developer — it is plain JSON inside the ` +
    `gzip, one array per table.</p>`;

  if (zipMB > MAIL_LIMIT_MB) {
    return NextResponse.json({
      ok: false,
      error: `the compressed backup is ${zipMB.toFixed(1)} MB, over the ${MAIL_LIMIT_MB} MB mail limit`,
      file: latest,
    }, { status: 413 });
  }

  const sent = await sendEmailWithAttachment(
    to,
    `🗄️ Weekly backup — ${latest.replace("backup-", "").replace(".json.gz", "").replace(".json", "")}`,
    emailShell("Weekly backup", summary),
    { filename: alreadyGz ? latest : `${latest}.gz`, content: zipped, contentType: "application/gzip" },
  );

  return NextResponse.json({
    ok: sent,
    to,
    file: latest,
    uncompressedMB: Number(rawMB.toFixed(1)),
    attachedMB: Number(zipMB.toFixed(1)),
  });
}
