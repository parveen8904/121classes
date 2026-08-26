import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendTelegramMessage } from "@/lib/notify";
import {
  AWAKE_FROM, AWAKE_TO, istHour, latestArticle, nextKind, nudgeText, recordNudge, shouldNudge,
} from "@/lib/groupNudge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// KEEP A QUIET STUDY GROUP POINTED AT SOMETHING USEFUL.
//
// His instruction, 26 Aug 2026: when the groups go silent, keep telling them to
// take a test, do the planner, look at the new articleship openings, apply for
// the scholarship, or read a new article.
//
// It speaks only into an empty room — a group with students talking in it is
// left alone. See lib/groupNudge.ts for the rest of the rules (once a day,
// waking hours only, all five rotate before any repeats).
export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // NOT AT NIGHT. `force=1` is for testing from the admin side, and still
  // respects the quiet and gap rules — it only lifts the clock.
  const force = params.get("force") === "1";
  const hour = istHour();
  if (!force && (hour < AWAKE_FROM || hour >= AWAKE_TO)) {
    return NextResponse.json({ ok: true, skipped: "outside waking hours IST", hour });
  }

  const svc = createServiceClient();
  const { data: subjects, error } = await svc
    .from("subjects")
    .select("id, title, telegram_group_chat_id")
    .not("telegram_group_chat_id", "is", null);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const article = await latestArticle();
  const done: { subject: string; kind: string | null; sent: boolean; why?: string }[] = [];

  for (const s of subjects ?? []) {
    const chat = String((s as { telegram_group_chat_id: string }).telegram_group_chat_id || "");
    const title = String((s as { title: string }).title || "Group");
    if (!chat) continue;

    if (!(await shouldNudge(chat))) {
      done.push({ subject: title, kind: null, sent: false, why: "group is active, or nudged recently" });
      continue;
    }

    const kind = await nextKind(chat, !!article);
    const nudge = kind ? nudgeText(kind, article) : null;
    if (!kind || !nudge) {
      done.push({ subject: title, kind: null, sent: false, why: "nothing to say" });
      continue;
    }

    const sent = await sendTelegramMessage(chat, nudge.text, nudge.link).catch(() => false);
    if (sent) await recordNudge(chat, kind);
    done.push({ subject: title, kind, sent: !!sent });
  }

  return NextResponse.json({ ok: true, hour, groups: done });
}
