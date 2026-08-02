import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyFaculty } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// THE DUTY ROUND — every six hours, four times a day.
//
// The founder's ask: don't just tell me a student is stuck, deal with it. So
// this walks the things that would otherwise sit waiting for a person, settles
// what it can from facts the site already holds, and writes to him ONLY when
// something genuinely needs a human. A quiet round sends no email at all —
// otherwise the report becomes noise and stops being read.

type Handled = { what: string; detail: string };
type Drafted = { what: string; detail: string };
type NeedsHuman = { what: string; detail: string; since: string };

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const handled: Handled[] = [];
  const drafted: Drafted[] = [];
  const needsHuman: NeedsHuman[] = [];

  // ---- 1. Login-help requests ------------------------------------------
  // Close the ones whose student has since signed in; try to solve the rest.
  const { data: openLogin } = await svc
    .from("page_questions")
    .select("id, question, created_at")
    .eq("page_path", "login-help")
    .eq("status", "open")
    .order("created_at");

  for (const row of openLogin ?? []) {
    const q = String(row.question ?? "");
    const email = /tried email:\s*([^\s·]+)/.exec(q)?.[1] ?? "";
    const phone = /WhatsApp:\s*([0-9+]+)/.exec(q)?.[1] ?? "";
    const name = /—\s*([^·]+)·/.exec(q)?.[1]?.trim() ?? "";

    // Already signed in since asking? Close it, tell nobody.
    if (email) {
      const { data: u } = await svc
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      if (u?.id) {
        const { data: authUser } = await svc.auth.admin.getUserById(String(u.id));
        const last = authUser?.user?.last_sign_in_at ? new Date(authUser.user.last_sign_in_at).getTime() : 0;
        if (last > new Date(String(row.created_at)).getTime()) {
          await svc.from("page_questions").update({ status: "answered" }).eq("id", row.id);
          handled.push({ what: "Login help", detail: `${name || email} got in by themselves — request closed.` });
          continue;
        }
      }
    }

    try {
      const { rescueLogin } = await import("@/lib/loginRescue");
      const r = await rescueLogin({ name, phone, email });
      if (r.handled) {
        await svc.from("page_questions").update({ status: "answered" }).eq("id", row.id);
        handled.push({ what: "Login help", detail: `${name || email}: ${r.note}` });
      } else {
        needsHuman.push({ what: "Login help", detail: `${name || "?"} (${phone || "no phone"}) — ${r.note}`, since: String(row.created_at) });
      }
    } catch {
      needsHuman.push({ what: "Login help", detail: `${name || email} — automatic help failed`, since: String(row.created_at) });
    }
  }

  // ---- 2. Student doubts — DRAFT a reply, never send it ----------------
  // His instruction: he reads every draft before a student sees it, and
  // moderates where needed. So the round prepares the answer from HIS OWN
  // repository (classes, notes, question banks) and leaves it for approval.
  const { data: openDoubts } = await svc
    .from("page_questions")
    .select("id, question, page_path, created_at, email, user_id")
    .eq("status", "open")
    .neq("page_path", "login-help")
    .is("drafted_at", null)
    .order("created_at")
    .limit(15);

  for (const d of openDoubts ?? []) {
    try {
      const [{ getRepositoryContext }, { answerDoubtFromMaterial, aiConfigured, NEED_FACULTY }] = await Promise.all([
        import("@/lib/repository"),
        import("@/lib/ai"),
      ]);
      if (!(await aiConfigured())) break;

      // Answer ONLY from his material — the same repository the portal's own
      // doubt answering uses, so a drafted reply cites his classes and notes
      // rather than general knowledge.
      const question = String(d.question ?? "");
      const material = await getRepositoryContext(null, 24000, { query: question });
      // No AI disclaimer on a draft: he reads it, edits it and sends it, so the
      // student receives it as his reply. The site already says AI assists here.
      const draft = await answerDoubtFromMaterial(question, material, "doubt", { betaNote: false });

      if (draft && draft.trim() !== NEED_FACULTY) {
        await svc
          .from("page_questions")
          .update({ draft_reply: draft, drafted_at: new Date().toISOString() })
          .eq("id", d.id);
        drafted.push({ what: "Doubt", detail: String(d.question).slice(0, 70) });
      } else {
        needsHuman.push({
          what: "Doubt the AI would not answer",
          detail: String(d.question).slice(0, 120),
          since: String(d.created_at),
        });
      }
    } catch {
      needsHuman.push({ what: "Student doubt", detail: String(d.question).slice(0, 120), since: String(d.created_at) });
    }
  }

  // ---- 3. Things only a person can decide ------------------------------
  const [{ count: ticketsOpen }, { count: examinerWaiting }, { count: keysWaiting }] = await Promise.all([
    svc.from("tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
    svc.from("paper_attempts").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    svc.from("item_solutions").select("id", { count: "exact", head: true }).eq("status", "drafted"),
  ]);
  if ((ticketsOpen ?? 0) > 0) needsHuman.push({ what: "Support tickets", detail: `${ticketsOpen} open`, since: "" });
  if ((examinerWaiting ?? 0) > 0) needsHuman.push({ what: "Examiner desk", detail: `${examinerWaiting} answer book(s) waiting`, since: "" });
  if ((keysWaiting ?? 0) > 0) needsHuman.push({ what: "Answer keys", detail: `${keysWaiting} drafted key(s) awaiting your approval`, since: "" });

  // ---- 4. Report — but only if there is something to say ---------------
  if (needsHuman.length || drafted.length) {
    const fmt = (s: string) =>
      s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";
    await notifyFaculty(
      drafted.length
        ? `${drafted.length} drafted repl${drafted.length === 1 ? "y" : "ies"} ready for you to approve`
        : `${needsHuman.length} thing${needsHuman.length === 1 ? "" : "s"} need${needsHuman.length === 1 ? "s" : ""} a person`,
      [
        handled.length
          ? `Handled automatically this round (${handled.length}):\n` + handled.map((h) => `  • ${h.what}: ${h.detail}`).join("\n") + "\n"
          : "",
        drafted.length
          ? `Replies drafted from your own repository, waiting for you to read and send (${drafted.length}) — Admin → Inbox & doubts:\n` +
            drafted.map((d) => `  • ${d.detail}`).join("\n") + "\n"
          : "",
        needsHuman.length ? "Needs you:" : "",
        ...needsHuman.map((n) => `  • ${n.what}: ${n.detail}${n.since ? ` (since ${fmt(n.since)})` : ""}`),
      ]
        .filter(Boolean)
        .join("\n"),
    ).catch(() => false);
  }

  return NextResponse.json({
    ok: true,
    handled: handled.length,
    drafted: drafted.length,
    needsHuman: needsHuman.length,
    quiet: needsHuman.length === 0 && drafted.length === 0,
    details: { handled, drafted, needsHuman },
  });
}
