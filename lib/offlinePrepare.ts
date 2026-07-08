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
export async function prepareStep(sectionId: string, timeBudgetMs = 170_000): Promise<StepResult> {
  const svc = createServiceClient();
  const started = Date.now();

  // Load or create the job.
  let { data: job } = await svc.from("offline_jobs").select("*").eq("section_id", sectionId).maybeSingle() as { data: Job | null };
  if (job?.status === "done") return { done: true, status: "done", bytesDone: job.bytes_done, bytesTotal: job.bytes_total };

  const { data: sec } = await svc.from("sections").select("title, min_plan, config, topics(subject_id)").eq("id", sectionId).maybeSingle();
  const guid = ((sec?.config ?? {}) as Record<string, string>).bunny_video_id || "";
  if (!sec || !guid) return { done: false, status: "error", bytesDone: 0, bytesTotal: null, error: "No Bunny video on this class" };

  const r2 = await r2Client();
  if (!r2) return { done: false, status: "error", bytesDone: 0, bytesTotal: null, error: "R2 not configured" };

  // Bunny blocks direct MP4 access by default — unlock while we work (relocked
  // by the caller when no jobs remain).
  await bunnyLibraryPatch({ AllowDirectPlay: true });

  if (!job) {
    // Pick the best available MP4 rendition (prefer 720p — right size for phones).
    let resolution = "";
    let total = 0;
    for (const res of ["720p", "480p", "360p"]) {
      const head = await fetch(`https://${CDN_HOST}/${guid}/play_${res}.mp4`, { method: "HEAD", cache: "no-store" });
      if (head.ok) { resolution = res; total = Number(head.headers.get("content-length")) || 0; break; }
    }
    if (!resolution) return { done: false, status: "error", bytesDone: 0, bytesTotal: null, error: "No MP4 rendition available yet (Bunny may still be encoding)" };

    const storageKey = `offline/${sectionId}-${resolution}.enc`;
    // Start the S3 multipart upload.
    const create = await r2.aws.fetch(`${r2.endpoint}/${storageKey}?uploads=`, { method: "POST" });
    const createXml = await create.text();
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(createXml)?.[1];
    if (!create.ok || !uploadId) return { done: false, status: "error", bytesDone: 0, bytesTotal: total, error: "Could not start R2 upload" };

    const ins = {
      section_id: sectionId, guid, resolution, status: "running", bytes_total: total, bytes_done: 0,
      upload_id: uploadId, parts: [], key_b64: randomBytes(32).toString("base64"),
      iv_b64: randomBytes(16).toString("base64"), last_block_b64: null, storage_key: storageKey,
    };
    const { data: created } = await svc.from("offline_jobs").insert(ins).select("*").single();
    job = created as Job;
  }
  if (!job) return { done: false, status: "error", bytesDone: 0, bytesTotal: null, error: "job create failed" };

  const total = Number(job.bytes_total) || 0;
  let bytesDone = Number(job.bytes_done) || 0;
  let parts = (job.parts ?? []) as { PartNumber: number; ETag: string }[];
  let chainIv = Buffer.from(job.last_block_b64 || job.iv_b64, "base64");
  const key = Buffer.from(job.key_b64, "base64");

  try {
    while (bytesDone < total && Date.now() - started < timeBudgetMs) {
      const end = Math.min(bytesDone + CHUNK, total) - 1;
      const isFinal = end === total - 1;
      const res = await fetch(`https://${CDN_HOST}/${job.guid}/play_${job.resolution}.mp4`, {
        headers: { range: `bytes=${bytesDone}-${end}` },
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
      const up = await r2.aws.fetch(
        `${r2.endpoint}/${job.storage_key}?partNumber=${partNumber}&uploadId=${encodeURIComponent(job.upload_id!)}`,
        { method: "PUT", body: enc },
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
      { method: "POST", body: xml, headers: { "content-type": "application/xml" } },
    );
    if (!fin.ok) throw new Error(`R2 complete HTTP ${fin.status}`);

    const encryptedSize = total + (16 - (total % 16));
    const subjectId = (sec as { topics?: { subject_id?: string } | null }).topics?.subject_id ?? null;
    await svc.from("protected_videos").upsert(
      {
        title: (sec.title as string) || "Class",
        subject_id: subjectId,
        section_id: sectionId,
        min_plan: (sec.min_plan as string) ?? null,
        storage_url: `${r2.publicBase}/${job.storage_key}`,
        key_b64: job.key_b64,
        iv_b64: job.iv_b64,
        alg: "aes-256-cbc",
        byte_size: encryptedSize,
        is_published: true,
      },
      { onConflict: "section_id" },
    );
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

// Continue the oldest unfinished job (used by the hourly cron to drain the backlog).
export async function prepareNextPending(timeBudgetMs = 150_000): Promise<StepResult | null> {
  const svc = createServiceClient();
  const { data: next } = await svc
    .from("offline_jobs")
    .select("section_id")
    .in("status", ["pending", "running"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!next) return null;
  return prepareStep(next.section_id as string, timeBudgetMs);
}
