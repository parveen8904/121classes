import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { instagramComments, facebookComments, type SocialComment } from "@/lib/socialComments";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// SOCIAL COMMENTS INTO THE ONE DOUBT LOG.
//
// Every hour, the comments under our Instagram and Facebook posts are read and
// the ones that are actually QUESTIONS are written into the same log as
// WhatsApp, Telegram, email and the class doubt box. "How to purchase classes?"
// waited five months under a post because comments were the only door that led
// nowhere.
//
// A draft answer is written but NOT published. Public replies are different
// from a private message: they are permanent, they are read by everyone who
// finds the post, and they carry his name in front of strangers. So the report
// holds a suggested reply and a person presses send. That can be made automatic
// the day he wants it — nothing in the plumbing assumes otherwise.
//
// Praise is left alone. A hundred identical "thank you" replies from a machine
// under a hundred kind comments is worse than silence.

const CHANNEL = { instagram: "instagram", facebook: "facebook" } as const;

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const [ig, fb] = await Promise.all([instagramComments(), facebookComments()]);
  const all: SocialComment[] = [...ig, ...fb];
  if (!all.length) return NextResponse.json({ ok: true, seen: 0, note: "nothing readable — check permissions" });

  // Only what has not been logged before. The comment id is the key, kept in
  // page_path so one row can never be written twice.
  const ids = all.map((c) => `${c.platform}:${c.commentId}`);
  const { data: seenRows } = await svc
    .from("social_comments_seen")
    .select("comment_key")
    .in("comment_key", ids);
  const seen = new Set((seenRows ?? []).map((r) => String(r.comment_key)));

  const ai = await import("@/lib/ai");
  const { getRepositoryContext } = await import("@/lib/repository");
  const configured = await ai.aiConfigured();

  let logged = 0;
  let skipped = 0;

  for (const c of all) {
    const key = `${c.platform}:${c.commentId}`;
    if (seen.has(key)) continue;

    // Mark it seen whatever happens, so a comment we decide not to answer is
    // not reconsidered every hour for ever.
    await svc.from("social_comments_seen").insert({ comment_key: key }).select().maybeSingle();

    if (!configured) { skipped++; continue; }

    // Praise, emoji and abuse are not questions. Judged by the same test every
    // other channel uses, so the line is drawn in one place.
    const judged = await ai.judgeStudentMessage(c.text);
    if (judged.kind !== "question") { skipped++; continue; }

    let draft: string | null = null;
    try {
      const material = await getRepositoryContext(null, 12000, { query: c.text });
      draft = await ai.answerDoubtFromMaterial(c.text, material, "doubt", { betaNote: false });
      if (!draft || draft.trim() === ai.NEED_FACULTY) {
        draft = await ai.replyFromSiteMap(c.text).catch(() => null);
      }
    } catch { /* a doubt with no draft is still worth logging */ }

    await svc.from("page_questions").insert({
      user_id: null,
      email: null,
      page_path: c.platform === "instagram" ? CHANNEL.instagram : CHANNEL.facebook,
      question: `${c.text}\n\n— ${c.author ?? "someone"} on ${c.platform}${c.permalink ? `\n${c.permalink}` : ""}`,
      status: "open",
      draft_reply: draft,
      drafted_at: draft ? new Date().toISOString() : null,
    });
    logged++;
  }

  return NextResponse.json({ ok: true, seen: all.length, logged, skipped });
}
