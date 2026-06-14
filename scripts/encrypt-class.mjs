#!/usr/bin/env node
// Encrypt a class video for the downloadable-classes repository.
//
//   node scripts/encrypt-class.mjs <input.mp4> [output.enc]
//
// Produces an AES-256-CBC encrypted file (safe to host on a public CDN) and
// prints the key + IV to register in Admin → Downloadable classes. The desktop
// app downloads the .enc file and decrypts it after the server releases the key.

import { createCipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";

const [, , input, outputArg] = process.argv;
if (!input) {
  console.error("Usage: node scripts/encrypt-class.mjs <input.mp4> [output.enc]");
  process.exit(1);
}
const output = outputArg || input.replace(/\.[^.]+$/, "") + ".enc";

const key = randomBytes(32); // AES-256
const iv = randomBytes(16);
const cipher = createCipheriv("aes-256-cbc", key, iv);

await pipeline(createReadStream(input), cipher, createWriteStream(output));

const size = statSync(output).size;
console.log("\n✅ Encrypted →", output);
console.log("\nRegister these in Admin → Downloadable classes:");
console.log("  alg       : aes-256-cbc");
console.log("  key_b64   :", key.toString("base64"));
console.log("  iv_b64    :", iv.toString("base64"));
console.log("  byte_size :", size);
console.log("\nUpload the .enc file to your CDN (e.g. Bunny Storage) and paste its public URL as storage_url.\n");
