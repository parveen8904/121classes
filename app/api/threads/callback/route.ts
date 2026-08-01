import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { threadsExchangeCode } from "@/lib/threads";

export const dynamic = "force-dynamic";

// Lands here from threads.net/oauth/authorize. The state parameter must match
// the value minted in app_secrets before the flow began — without that check,
// anyone could complete the flow with their own code and point the site's
// Threads posting at their account.
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const code = p.get("code");
  const state = p.get("state") ?? "";
  const expected = (await getSecret("THREADS_OAUTH_STATE")).trim();

  if (!code || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/admin/integrations?threads=denied", req.url));
  }

  const redirectUri = new URL("/api/threads/callback", req.url).toString();
  const r = await threadsExchangeCode(code, redirectUri);
  return NextResponse.redirect(
    new URL(r.ok ? `/admin/integrations?threads=connected&u=${encodeURIComponent(r.username ?? "")}` : `/admin/integrations?threads=failed`, req.url),
  );
}
