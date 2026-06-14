#!/usr/bin/env node
// One-command publish: encrypt a class → upload to Bunny Storage → register it
// in the downloadable-classes repository. Runs locally (NOT on Vercel) so it can
// handle multi-GB lectures.
//
//   node scripts/publish-class.mjs <video.mp4> "<title>" [subjectSlug]
//
// Required env (export or put in your shell):
//   BUNNY_STORAGE_ZONE      e.g. ca-classes
//   BUNNY_STORAGE_KEY       the storage zone password (FTP & API access key)
//   BUNNY_PULL_ZONE_HOST    public CDN hostname, e.g. ca-classes.b-cdn.net
//   SUPABASE_URL            https://ydpkcmyjkekvfwnnvphn.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   (server-only key)
// Optional:
//   BUNNY_STORAGE_HOST      default storage.bunnycdn.com (use region host if set)
//   CLASS_MIN_PLAN          gold | silver | bronze   (default gold)

import { createCipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, statSync, unlinkSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";

const [, , video, title, subjectSlug] = process.argv;
if (!video || !title) {
  console.error('Usage: node scripts/publish-class.mjs <video.mp4> "<title>" [subjectSlug]');
  process.exit(1);
}

const env = (k, required = true) => {
  const v = process.env[k];
  if (required && !v) { console.error(`Missing env ${k}`); process.exit(1); }
  return v;
};
const ZONE = env("BUNNY_STORAGE_ZONE");
const KEY = env("BUNNY_STORAGE_KEY");
const PULL = env("BUNNY_PULL_ZONE_HOST");
const SB_URL = env("SUPABASE_URL");
const SB_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const STORAGE_HOST = process.env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com";
const MIN_PLAN = process.env.CLASS_MIN_PLAN || "gold";

// 1) Encrypt -> temp .enc
const aesKey = randomBytes(32);
const iv = randomBytes(16);
const encPath = video.replace(/\.[^.]+$/, "") + ".enc";
console.log("Encrypting…");
await pipeline(createReadStream(video), createCipheriv("aes-256-cbc", aesKey, iv), createWriteStream(encPath));
const size = statSync(encPath).size;

// 2) Upload to Bunny Storage
const remote = `classes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.enc`;
const putUrl = `https://${STORAGE_HOST}/${ZONE}/${remote}`;
console.log("Uploading to Bunny Storage…");
const res = await fetch(putUrl, {
  method: "PUT",
  headers: { AccessKey: KEY, "Content-Type": "application/octet-stream" },
  body: createReadStream(encPath),
  duplex: "half",
});
if (!res.ok) { console.error("Bunny upload failed:", res.status, await res.text()); process.exit(1); }
const storageUrl = `https://${PULL}/${remote}`;

// 3) Register in Supabase
const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
let subjectId = null;
if (subjectSlug) {
  const { data } = await supabase.from("subjects").select("id").eq("slug", subjectSlug).maybeSingle();
  subjectId = data?.id ?? null;
  if (!subjectId) console.warn(`(subject "${subjectSlug}" not found — registering with no subject)`);
}
const { error } = await supabase.from("protected_videos").insert({
  title, subject_id: subjectId, min_plan: MIN_PLAN,
  storage_url: storageUrl, key_b64: aesKey.toString("base64"), iv_b64: iv.toString("base64"),
  alg: "aes-256-cbc", byte_size: size, is_published: true,
});
if (error) { console.error("DB register failed:", error.message); process.exit(1); }

try { unlinkSync(encPath); } catch {}
console.log(`\n✅ Published "${title}"  (${(size / 1e6).toFixed(0)} MB)\n   ${storageUrl}\n   Visible now in the desktop app for ${MIN_PLAN}+ students.\n`);
