import { createHmac } from "node:crypto";
import { getSecret } from "@/lib/secrets";

// Zoom Meeting SDK (white-label embed). We host the class INSIDE our own site —
// students never see a zoom.us link. Needs a Zoom "Meeting SDK" app: paste its
// SDK Key + Secret on the Integrations page. SERVER-ONLY.

export async function zoomSdkConfigured(): Promise<boolean> {
  return Boolean((await getSecret("ZOOM_SDK_KEY")) && (await getSecret("ZOOM_SDK_SECRET")));
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Generate a Meeting SDK signature (JWT, HS256) for joining a meeting/webinar.
// role: 0 = attendee (students), 1 = host.
export async function zoomSignature(meetingNumber: string, role = 0): Promise<{ signature: string; sdkKey: string } | null> {
  const sdkKey = await getSecret("ZOOM_SDK_KEY");
  const sdkSecret = await getSecret("ZOOM_SDK_SECRET");
  if (!sdkKey || !sdkSecret || !meetingNumber) return null;
  const iat = Math.floor(Date.now() / 1000) - 30;
  const exp = iat + 60 * 60 * 4; // 4 hours
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    appKey: sdkKey, sdkKey, mn: String(meetingNumber).replace(/\D/g, ""), role, iat, exp, tokenExp: exp,
  }));
  const sig = createHmac("sha256", sdkSecret).update(`${header}.${payload}`).digest();
  return { signature: `${header}.${payload}.${b64url(sig)}`, sdkKey };
}
