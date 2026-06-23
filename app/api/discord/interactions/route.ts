import { waitUntil } from "@vercel/functions";
import { createPublicKey, verify } from "node:crypto";
import { getSecret } from "@/lib/secrets";
import { aiConfigured, answerDoubtFromMaterial, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Verify Discord's Ed25519 request signature (raw 32-byte hex public key → SPKI).
function verifyDiscord(publicKeyHex: string, signatureHex: string, timestamp: string, rawBody: string): boolean {
  try {
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

// Answer the doubt from the repository, then edit the deferred reply in Discord.
async function answerAndFollowup(token: string, question: string) {
  const appId = await getSecret("DISCORD_APP_ID");
  if (!appId) return;
  let answer = "";
  try {
    if (question && (await aiConfigured())) {
      const material = await getRepositoryContext(null, 12000, { query: question });
      const raw = await answerDoubtFromMaterial(question, material);
      if (raw && raw.trim() !== NEED_FACULTY) answer = raw;
    }
  } catch {
    /* fall through to the faculty message */
  }
  if (!answer) {
    answer =
      "I couldn't answer that from the class material. Please ask it on the website (the *Ask your doubts* button on your subject page) — it can reach the faculty. 🙏";
  }
  const content = `**Q:** ${question}\n\n${answer}\n\n— guided by CA Parveen Sharma`.slice(0, 1900);
  try {
    await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
      cache: "no-store",
    });
  } catch {
    /* ignore */
  }
}

export async function POST(req: Request) {
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  const raw = await req.text();
  const publicKey = await getSecret("DISCORD_PUBLIC_KEY");

  if (!publicKey || !sig || !ts || !verifyDiscord(publicKey, sig, ts, raw)) {
    return new Response("invalid request signature", { status: 401 });
  }

  const body = JSON.parse(raw) as {
    type: number;
    token: string;
    data?: { name?: string; options?: { name: string; value: string }[] };
  };

  // 1 = PING (Discord's endpoint verification)
  if (body.type === 1) return Response.json({ type: 1 });

  // 2 = APPLICATION_COMMAND
  if (body.type === 2) {
    const name = body.data?.name;
    if (name === "ask" || name === "doubt") {
      const question = (body.data?.options ?? []).find((o) => o.name === "question")?.value ?? "";
      // Acknowledge now (deferred); finish the answer after responding (waitUntil
      // keeps the function alive past the HTTP response).
      waitUntil(answerAndFollowup(body.token, question));
      return Response.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    }
  }

  return Response.json({ type: 4, data: { content: "Unknown command." } });
}
