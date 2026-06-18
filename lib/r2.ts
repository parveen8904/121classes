import { AwsClient } from "aws4fetch";
import { getSecret } from "@/lib/secrets";

// Cloudflare R2 (S3-compatible) — optional alternative storage for PDFs/images.
// Configured via the admin secret store. When set, new uploads go to R2 via a
// browser presigned PUT (no Vercel body-size limit, no double bandwidth).

export async function r2Configured(): Promise<boolean> {
  return Boolean(
    (await getSecret("R2_ACCOUNT_ID")) &&
      (await getSecret("R2_ACCESS_KEY_ID")) &&
      (await getSecret("R2_SECRET_ACCESS_KEY")) &&
      (await getSecret("R2_BUCKET")),
  );
}

// Create a presigned PUT URL the browser uploads straight to, plus the public
// URL the file will be served from.
export async function presignR2Put(
  key: string,
  contentType: string,
): Promise<{ uploadUrl: string; publicUrl: string } | null> {
  const accountId = await getSecret("R2_ACCOUNT_ID");
  const accessKeyId = await getSecret("R2_ACCESS_KEY_ID");
  const secretAccessKey = await getSecret("R2_SECRET_ACCESS_KEY");
  const bucket = await getSecret("R2_BUCKET");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeURIComponent(key)}`;
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  // Presigned URL valid ~10 minutes.
  const signed = await aws.sign(`${endpoint}?X-Amz-Expires=600`, {
    method: "PUT",
    headers: { "content-type": contentType || "application/octet-stream" },
    aws: { signQuery: true },
  });

  // Public base: custom domain or the r2.dev URL. Falls back to the S3 endpoint.
  const base = (await getSecret("R2_PUBLIC_BASE")) || `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  const publicUrl = `${base.replace(/\/$/, "")}/${key}`;
  return { uploadUrl: signed.url, publicUrl };
}
