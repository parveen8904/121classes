import { createCipheriv, randomBytes } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

// ---------------------------------------------------------------------------
// Offline-class preparation: pull a class's 720p MP4 from Bunny, encrypt it
// (AES-256-CBC — same scheme the desktop & mobile apps decrypt), store it on
// R2, and register it in protected_videos so "Download for offline" appears.
//
// RESUMABLE by design: each call encrypts up to a time budget using ranged
// downloads + S3 multipart upload, persisting the cipher chain state
// (last ciphertext block = IV of the next chunk). Any size survives serverless
// time limits; the hourly cron finishes whatever a button click started.
// ---------------------------------------------------------------------------

const CHUNK = 64 * 1024 * 1024; // 64 MB per slice-part (multiple of 16)
const CDN_HOST = "vz-839ca0ae-eec.b-cdn.net";
// The library blocks requests with no/foreign referer (hotlink protection) —
// our server-side fetches must identify as the site or Bunny answers 403.
const REFERER = "https://caparveensharma.com/";

type Job = {
  id: string; section_id: string; guid: string; resolution: string; status: string;
  bytes_total: number | null; bytes_done: number; upload_id: string | null;
  parts: { PartNumber: number; ETag: string }[];
  key_b64: string; iv_b64: string; last_block_b64: string | null; storage_key: string;
};

async function bunnyLibraryPatch(body: Record<string, unknown>): Promise<void> {
  const acct = await getSecret("BUNNY_ACCOUNT_API_KEY");
  const lib = await getSecret("BUNNY_LIBRARY_ID");
  if (!acct || !lib) return;
  await fetch(`https://api.bunny.net/videolibrary/${lib}`, {
    method: "POST",
    headers: { AccessKey: acct, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => {});
}

// Stream-library video API (per-video info / re-encode) — different host+key
// from the account-level library-settings API above.
async function bunnyVideoApi(path: string, method: "GET" | "POST" = "GET"): Promise<Record<string, unknown> | null> {
  const key = await getSecret("BUNNY_STREAM_API_KEY");
  const lib = await getSecret("BUNNY_LIBRARY_ID");
  if (!key || !lib) return null;
  const res = await fetch(`https://video.bunnycdn.com/library/${lib}/videos/${path}`, {
    method,
    headers: { AccessKey: key, accept: "application/json" },
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

async function r2Client(): Promise<{ aws: AwsClient; endpoint: string; publicBase: string } | null> {
  const accountId = await getSecret("R2_ACCOUNT_ID");
  const accessKeyId = await getSecret("R2_ACCESS_KEY_ID");
  const secretAccessKey = await getSecret("R2_SECRET_ACCESS_KEY");
  const bucket = await getSecret("R2_BUCKET");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  const publicBase = ((await getSecret("R2_PUBLIC_BASE")) || endpoint).replace(/\/$/, "");
  return { aws: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }), endpoint, publicBase };
}

// PKCS7-pad the final plaintext chunk (we encrypt with autopadding OFF so the
// cipher chain can pause/resume between serverless invocations).
function pkcs7(buf: Buffer): Buffer {
  const pad = 16 - (buf.length % 16);
  return Buffer.concat([buf, Buffer.alloc(pad, pad)]);
}

export type StepResult = { done: boolean; status: string; bytesDone: number; bytesTotal: number | null; error?: string };

// Run ONE resumable slice for a section's offline job. Creates the job on first
// call. Returns done=true when the class is fully prepared & registered.
// Which qualities we prepare, best first. 240p is deliberately left out: at
// 263 kbps a worked ledger on the board stops being readable, and a class a
// student cannot read is not a smaller file, it is a wasted download.
export const OFFLINE_QUALITIES = ["1080p", "720p", "480p", "360p"] as const;
export type OfflineQuality = (typeof OFFLINE_QUALITIES)[number];

export async function prepareStep(
  sectionId: string,
  timeBudgetMs = 170_000,
  want?: OfflineQuality,
): Promise<StepResult> {
  const svc = createServiceClient();
  const started = Date.now();

  // Load or create the job — one per class PER QUALITY now, so a student can
  // choose 360p on a phone and 720p on a laptop.
  let job: Job | null = null;
  {
    let q = svc.from("offline_jobs").select("*").eq("section_id", sectionId);
    q = want ? q.eq("resolution", want) : q.order("created_at", { ascending: true });
    const { data } = await q.limit(1).maybeSingle();
    job = (data ?? null) as Job | null;
  }
  if (job?.status === "done") return { done: true, status: "done", bytesDone: job.bytes_done, bytesTotal: job.bytes_total };

  // Lease: a running job touched in the last 2.5 min is being worked by another
  // invocation (the 5-min cron or an admin tab) — report progress, don't join in
  // (two writers would corrupt the multipart upload).
  if (job?.status === "running") {
    const touched = (job as unknown as { updated_at?: string }).updated_at;
    if (touched && Date.now() - new Date(touched).getTime() < 150_000 && Number(job.bytes_done) > 0) {
      return { done: false, status: "running", bytesDone: Number(job.bytes_done) || 0, bytesTotal: job.bytes_total };
    }
  }

  const { data: sec } = await svc.from("sections").select("title, min_plan, config, topics(subject_id)").eq("id", sectionId).maybeSingle();
  const guid = ((sec?.config ?? {}) as Record<string, string>).bunny_video_id || "";
  if (!sec || !guid) return { done: false, status: "error", bytesDone: 0, bytesTotal: null, error: "No Bunny video on this class" };

  const r2 = await r2Client();
  if (!r2) return { done: false, status: "error", bytesDone: 0, bytesTotal: null, error: "R2 not configured" };

  // Bunny blocks direct MP4 access by default — unlock while we work (relocked
  // by the caller when no jobs remain). MP4 Fallback stays on permanently so
  // every newly uploaded class gets a downloadable MP4 at encode time.
  await bunnyLibraryPatch({ AllowDirectPlay: true, EnableMP4Fallback: true });

  // Probe Bunny for the rendition asked for; fall back down the ladder only
  // when nothing was asked for, so a request for 360p never quietly returns a
  // 1.4 GB file.
  let resolution = job?.resolution || "";
  let total = Number(job?.bytes_total) || 0;
  let saw403 = false;
  if (!resolution) {
    for (const res of want ? [want] : ["720p", "480p", "360p"]) {
      const head = await fetch(`https://${CDN_HOST}/${guid}/play_${res}.mp4`, { method: "HEAD", headers: { referer: REFERER }, cache: "no-store" });
      if (head.ok) { resolution = res; total = Number(head.headers.get("content-length")) || 0; break; }
      if (head.status === 403) saw403 = true;
    }
  }

  // 403 means the MP4s exist but direct access stayed locked — the library
  // settings call must have failed. Don't waste a re-encode on that.
  if (!resolution && saw403) {
    return { done: false, status: "error", bytesDone: 0, bytesTotal: null, error: "Bunny refused direct access — check BUNNY_ACCOUNT_API_KEY in Admin → Integrations" };
  }

  if (!resolution) {
    // Classes encoded before MP4 Fallback was enabled have no downloadable MP4.
    // Ask Bunny to re-encode this video (it still has the stored original) and
    // park the job as pending — the hourly run retries until the MP4 appears.
    const WAIT = "Bunny is re-creating this class's downloadable file — automatic, usually ready within 1–2 hours; no action needed";
    if (!job) {
      await bunnyVideoApi(`${guid}/reencode`, "POST");
      await svc.from("offline_jobs").insert({
        section_id: sectionId, guid, resolution: "", status: "pending",
        bytes_total: null, bytes_done: 0, upload_id: null, parts: [],
        key_b64: randomBytes(32).toString("base64"),
        iv_b64: randomBytes(16).toString("base64"),
        last_block_b64: null, storage_key: `offline/${sectionId}.enc`, error: WAIT,
      });
    } else {
      // Nudge Bunny again if this job has sat waiting for 6+ hours.
      const updatedAt = (job as unknown as { updated_at?: string }).updated_at;
      if (!updatedAt || Date.now() - new Date(updatedAt).getTime() > 6 * 3600_000) {
        await bunnyVideoApi(`${guid}/reencode`, "POST");
      }
      await svc.from("offline_jobs").update({ status: "pending", error: WAIT, updated_at: new Date().toISOString() }).eq("id", job.id);
    }
    return { done: false, status: "pending", bytesDone: 0, bytesTotal: null, error: WAIT };
  }

  if (!job || !job.resolution) {
    // MP4 is available — initialise (or wake a parked job): pin the resolution
    // and start the S3 multipart upload.
    const storageKey = `offline/${sectionId}-${resolution}.enc`;
    const create = await r2.aws.fetch(`${r2.endpoint}/${storageKey}?uploads=`, { method: "POST" });
    const createXml = await create.text();
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(createXml)?.[1];
    if (!create.ok || !uploadId) return { done: false, status: "error", bytesDone: 0, bytesTotal: total, error: "Could not start R2 upload" };

    if (!job) {
      const ins = {
        section_id: sectionId, guid, resolution, status: "running", bytes_total: total, bytes_done: 0,
        upload_id: uploadId, parts: [], key_b64: randomBytes(32).toString("base64"),
        iv_b64: randomBytes(16).toString("base64"), last_block_b64: null, storage_key: storageKey,
      };
      const { data: created } = await svc.from("offline_jobs").insert(ins).select("*").single();
      job = created as Job;
    } else {
      const { data: woken } = await svc.from("offline_jobs").update({
        resolution, status: "running", bytes_total: total, bytes_done: 0, upload_id: uploadId,
        parts: [], last_block_b64: null, storage_key: storageKey, error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).select("*").single();
      job = woken as Job;
    }
  }
  if (!job) return { done: false, status: "error", bytesDone: 0, bytesTotal: null, error: "job create failed" };

  total = Number(job.bytes_total) || 0;
  let bytesDone = Number(job.bytes_done) || 0;
  let parts = (job.parts ?? []) as { PartNumber: number; ETag: string }[];
  let chainIv = Buffer.from(job.last_block_b64 || job.iv_b64, "base64");
  const key = Buffer.from(job.key_b64, "base64");

  try {
    while (bytesDone < total && Date.now() - started < timeBudgetMs) {
      const end = Math.min(bytesDone + CHUNK, total) - 1;
      const isFinal = end === total - 1;
      const res = await fetch(`https://${CDN_HOST}/${job.guid}/play_${job.resolution}.mp4`, {
        headers: { range: `bytes=${bytesDone}-${end}`, referer: REFERER },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`download HTTP ${res.status}`);
      let plain: Buffer = Buffer.from(new Uint8Array(await res.arrayBuffer()));
      if (isFinal) plain = pkcs7(plain);

      const cipher = createCipheriv("aes-256-cbc", key, chainIv);
      cipher.setAutoPadding(false); // we manage padding so the chain can pause/resume
      const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
      chainIv = enc.subarray(enc.length - 16); // next chunk chains from the last block

      const partNumber = parts.length + 1;
      // R2 rejects streamed (chunked) uploads with 411 — declare the size explicitly.
      const up = await r2.aws.fetch(
        `${r2.endpoint}/${job.storage_key}?partNumber=${partNumber}&uploadId=${encodeURIComponent(job.upload_id!)}`,
        { method: "PUT", body: enc, headers: { "content-length": String(enc.length) } },
      );
      if (!up.ok) throw new Error(`R2 part HTTP ${up.status}`);
      const etag = up.headers.get("etag") || "";
      parts = [...parts, { PartNumber: partNumber, ETag: etag }];
      bytesDone = end + 1;

      await svc.from("offline_jobs").update({
        bytes_done: bytesDone, parts, last_block_b64: chainIv.toString("base64"),
        status: "running", updated_at: new Date().toISOString(), error: null,
      }).eq("id", job.id);
    }

    if (bytesDone < total) {
      return { done: false, status: "running", bytesDone, bytesTotal: total }; // resume on next call
    }

    // Finish: complete the multipart upload + register the protected video.
    const xml = `<CompleteMultipartUpload>${parts
      .map((p) => `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`)
      .join("")}</CompleteMultipartUpload>`;
    const fin = await r2.aws.fetch(
      `${r2.endpoint}/${job.storage_key}?uploadId=${encodeURIComponent(job.upload_id!)}`,
      { method: "POST", body: xml, headers: { "content-type": "application/xml", "content-length": String(Buffer.byteLength(xml)) } },
    );
    if (!fin.ok) throw new Error(`R2 complete HTTP ${fin.status}`);

    const encryptedSize = total + (16 - (total % 16));
    const subjectId = (sec as { topics?: { subject_id?: string } | null }).topics?.subject_id ?? null;
    // min_plan is NOT NULL — classes default to gold (261/262 are gold anyway).
    const { error: regErr } = await svc.from("protected_videos").upsert(
      {
        title: (sec.title as string) || "Class",
        subject_id: subjectId,
        section_id: sectionId,
        resolution: job.resolution,
        min_plan: (sec.min_plan as string) ?? "gold",
        storage_url: `${r2.publicBase}/${job.storage_key}`,
        key_b64: job.key_b64,
        iv_b64: job.iv_b64,
        alg: "aes-256-cbc",
        byte_size: encryptedSize,
        is_published: true,
      },
      { onConflict: "section_id,resolution" },
    );
    if (regErr) throw new Error(`register failed: ${regErr.message}`); // a silent miss here hides the class from students
    await svc.from("offline_jobs").update({ status: "done", bytes_done: total, updated_at: new Date().toISOString() }).eq("id", job.id);
    return { done: true, status: "done", bytesDone: total, bytesTotal: total };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    await svc.from("offline_jobs").update({ status: "error", error: msg, updated_at: new Date().toISOString() }).eq("id", job.id);
    return { done: false, status: "error", bytesDone, bytesTotal: total, error: msg };
  } finally {
    // Re-lock direct MP4 access when nothing is mid-flight.
    const { count } = await svc.from("offline_jobs").select("id", { count: "exact", head: true }).eq("status", "running");
    if (!count) await bunnyLibraryPatch({ AllowDirectPlay: false });
  }
}

// Drain the queue (used by the hourly cron). Jobs parked waiting for Bunny's
// re-encode return instantly as "pending", so the slice moves on to the next
// class instead of stalling on them.
export async function prepareNextPending(timeBudgetMs = 150_000): Promise<StepResult | null> {
  const svc = createServiceClient();
  const started = Date.now();
  const left = () => timeBudgetMs - (Date.now() - started);

  const { data: queued } = await svc
    .from("offline_jobs")
    .select("section_id, resolution")
    .in("status", ["pending", "running"])
    .order("created_at")
    .limit(20);
  let last: StepResult | null = null;
  for (const q of queued ?? []) {
    if (left() < 20_000) return last;
    const t0 = Date.now();
    last = await prepareStep(q.section_id as string, left(), (q.resolution as OfflineQuality) || undefined);
    if (last.status === "pending") continue; // parked for Bunny's re-encode
    if (last.status === "running" && Date.now() - t0 < 10_000) continue; // lease-blocked — another worker owns it
    return last;
  }

  // Queue empty (or everything is waiting on Bunny) → auto-enqueue the next
  // published classes that have no offline copy yet, so newly uploaded classes
  // become downloadable with zero admin steps. Gated on ≥1 successful job so
  // the pipeline proves itself on a manual run first (errors stay visible in
  // Admin → Offline downloads and are not retried automatically).
  const { count: doneCount } = await svc
    .from("offline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "done");
  if (!doneCount) return last;

  const [{ data: existing }, { data: secs }] = await Promise.all([
    svc.from("offline_jobs").select("section_id"),
    // ONLY the one key this needs. Selecting whole `config` rows pulled ~19 MB
    // of JSONB for 325 classes on every pass of a 5-minute cron — it was the
    // single heaviest query in the database (2,638 disk reads, 64% cache hit).
    // Same lesson as sections_meta: never read config across rows.
    svc
      .from("sections")
      .select("id, bunny_video_id:config->>bunny_video_id")
      .eq("type", "full_class_video")
      .eq("is_published", true)
      .order("order_index"),
  ]);
  const have = new Set((existing ?? []).map((e) => e.section_id as string));
  const targets = (secs ?? []).filter(
    (s) => (s as { bunny_video_id?: string | null }).bunny_video_id && !have.has(s.id as string),
  ).slice(0, 5);
  for (const t of targets) {
    if (left() < 20_000) return last;
    last = await prepareStep(t.id as string, left());
    if (last.status !== "pending") return last;
  }
  return last;
}


/**
 * Queue the SMALLER downloads for classes that already have one.
 *
 * Every class was prepared at 720p and nothing else, so the quality choice on
 * the student's screen had one option and was no choice at all. This adds the
 * missing sizes — a 170-minute class is 1.4 GB at 720p and 374 MB at 360p, and
 * a student on mobile data should be able to take the small one.
 *
 * It only ever ADDS: a class with no download at all is left to the existing
 * auto-enqueue above, and a quality already prepared is skipped. Safe to run on
 * every pass.
 */
export async function queueSmallerQualities(limit = 40): Promise<{ queued: number; remaining: number }> {
  const svc = createServiceClient();
  const WANT: OfflineQuality[] = ["480p", "360p"];

  // Classes that already have a finished download — those are the ones worth
  // giving a second size to.
  const { data: done } = await svc
    .from("offline_jobs")
    .select("section_id, guid, resolution, status")
    .eq("status", "done")
    .limit(2000);

  const haveByClass = new Map<string, Set<string>>();
  const guidByClass = new Map<string, string>();
  for (const j of done ?? []) {
    const sid = String(j.section_id);
    if (!haveByClass.has(sid)) haveByClass.set(sid, new Set());
    haveByClass.get(sid)!.add(String(j.resolution));
    if (j.guid) guidByClass.set(sid, String(j.guid));
  }

  // Anything already queued must not be queued twice.
  const { data: openJobs } = await svc
    .from("offline_jobs")
    .select("section_id, resolution")
    .neq("status", "done")
    .limit(4000);
  for (const j of openJobs ?? []) {
    const sid = String(j.section_id);
    if (!haveByClass.has(sid)) haveByClass.set(sid, new Set());
    haveByClass.get(sid)!.add(String(j.resolution));
  }

  const rows: Record<string, unknown>[] = [];
  let remaining = 0;
  for (const [sid, have] of haveByClass) {
    const guid = guidByClass.get(sid);
    if (!guid) continue; // no Bunny video recorded — nothing to pull from
    for (const res of WANT) {
      if (have.has(res)) continue;
      if (rows.length >= limit) { remaining += 1; continue; }
      rows.push({
        section_id: sid,
        guid,
        resolution: res,
        status: "pending",
        bytes_total: null,
        bytes_done: 0,
        upload_id: null,
        parts: [],
        key_b64: randomBytes(32).toString("base64"),
        iv_b64: randomBytes(16).toString("base64"),
        last_block_b64: null,
        storage_key: `offline/${sid}-${res}.enc`,
        queued_by: "smaller-qualities",
      });
    }
  }

  if (!rows.length) return { queued: 0, remaining };
  const { data: ins } = await svc.from("offline_jobs").insert(rows).select("id");
  return { queued: ins?.length ?? 0, remaining };
}
