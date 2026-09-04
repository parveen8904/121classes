import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// WHAT WENT OUT YESTERDAY, IN HIS INBOX EVERY MORNING.
//
// "Make a rule to check continuously. What is happening about the mails or
// messages or telegram. You have to review each day. What is going out?"
// — the founder, 4 September 2026.
//
// The reason he asked is worth writing down, because it is the thing this has
// to catch. stuck-at-signup sent 1,701 emails to 1,188 people over three weeks
// and 33 of them received NINE. Nothing was broken in a way anybody could see:
// the job ran, reported success, and its own cap silently read "nobody has had
// one" because a query was too long and PostgREST answered with nothing rather
// than an error. It was found when a student replied in anger.
//
// So this is not a volume report. Volume was normal. What was abnormal was ONE
// PERSON RECEIVING THE SAME THING OVER AND OVER, and that is what leads.
//
// Every channel, because the same fault could as easily be written into the
// Telegram or WhatsApp path tomorrow: they all record into `notifications`.

const REPEAT_LIMIT = 2; // more than this to one person, one template, one day

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  const params = new URL(req.url).searchParams;
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` || params.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  type Row = { channel: string | null; template: string | null; student_id: string | null; status: string | null };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc
      .from("notifications")
      .select("channel, template, student_id, status")
      .gte("sent_at", since)
      .range(from, from + 999);
    // A REPORT THAT CANNOT READ MUST SAY SO, NOT SAY "ALL QUIET".
    // The whole incident this exists for was a failed read being taken for an
    // empty answer.
    if (error) {
      return NextResponse.json({ ok: false, error: error.message, note: "nothing reported rather than reporting a quiet day" }, { status: 500 });
    }
    const page = data ?? [];
    rows.push(...(page as Row[]));
    if (page.length < 1000) break;
  }

  const byChannel = new Map<string, number>();
  const byTemplate = new Map<string, { n: number; people: Set<string>; channel: string }>();
  const perPerson = new Map<string, number>();
  for (const r of rows) {
    const ch = r.channel ?? "unknown";
    const tpl = r.template ?? "(none)";
    byChannel.set(ch, (byChannel.get(ch) ?? 0) + 1);
    const k = `${ch}|${tpl}`;
    const cur = byTemplate.get(k) ?? { n: 0, people: new Set<string>(), channel: ch };
    cur.n++;
    if (r.student_id) cur.people.add(r.student_id);
    byTemplate.set(k, cur);
    // Only where we know WHO. A null recipient cannot be counted as a repeat to
    // one person, and pretending otherwise would invent an alarm every day.
    if (r.student_id) {
      const pk = `${ch}|${tpl}|${r.student_id}`;
      perPerson.set(pk, (perPerson.get(pk) ?? 0) + 1);
    }
  }

  const repeats = [...perPerson.entries()]
    .filter(([, n]) => n > REPEAT_LIMIT)
    .sort((a, b) => b[1] - a[1]);

  // Who they are, so a name can be acted on rather than a uuid.
  const ids = [...new Set(repeats.map(([k]) => k.split("|")[2]))].slice(0, 50);
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await svc.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of profs ?? []) names.set(String(p.id), `${p.full_name ?? "—"} <${p.email ?? "no email"}>`);
  }

  // Who has asked us to stop, per channel. A number that climbs is the earliest
  // honest signal that something is sending too much — people vote with it long
  // before anybody writes in, and only one of them ever writes in.
  const { data: stops } = await svc.from("email_blocklist").select("channel");
  const stopsBy = new Map<string, number>();
  for (const r of (stops ?? []) as { channel: string | null }[]) {
    const c = r.channel ?? "email";
    stopsBy.set(c, (stopsBy.get(c) ?? 0) + 1);
  }
  const blocked = (stops ?? []).length;

  const summary = {
    ok: true,
    window: "last 24 hours",
    total: rows.length,
    by_channel: Object.fromEntries(byChannel),
    by_template: [...byTemplate.entries()]
      .map(([k, v]) => ({ channel: v.channel, template: k.split("|")[1], sent: v.n, people: v.people.size }))
      .sort((a, b) => b.sent - a.sent),
    repeats: repeats.map(([k, n]) => {
      const [channel, template, sid] = k.split("|");
      return { channel, template, who: names.get(sid) ?? sid, times: n };
    }),
    unsubscribed_total: blocked,
    unsubscribed_by_channel: Object.fromEntries(stopsBy),
  };

  if (params.get("dry") === "1") return NextResponse.json(summary);

  const to = (await getSecret("COST_ALERT_EMAIL")) || (await getSecret("NOTIFY_REPLY_TO")) || "";
  if (!to) return NextResponse.json({ ...summary, emailed: false, note: "no address to send the review to" });

  const worry = summary.repeats.length > 0;
  const rowsHtml = summary.by_template
    .map((t) => `<tr><td style="padding:3px 8px">${t.channel}</td><td style="padding:3px 8px">${t.template}</td><td style="padding:3px 8px;text-align:right">${t.sent}</td><td style="padding:3px 8px;text-align:right">${t.people}</td></tr>`)
    .join("");
  const repeatHtml = worry
    ? `<p style="color:#b91c1c"><strong>⚠️ ${summary.repeats.length} case(s) of the same message going to one person more than ${REPEAT_LIMIT} times:</strong></p><ul>`
      + summary.repeats.slice(0, 25).map((r) => `<li>${r.who} — <strong>${r.times}×</strong> ${r.template} (${r.channel})</li>`).join("")
      + "</ul>"
    : `<p style="color:#15803d">✓ Nobody received the same message more than ${REPEAT_LIMIT} times.</p>`;

  await sendEmail(
    to,
    `${worry ? "⚠️ " : ""}What went out yesterday — ${summary.total} messages`,
    `<p>Everything this site sent in the last 24 hours, by channel and template.</p>`
      + repeatHtml
      + `<table style="border-collapse:collapse;font-size:14px"><tr><th align="left" style="padding:3px 8px">Channel</th><th align="left" style="padding:3px 8px">Template</th><th align="right" style="padding:3px 8px">Sent</th><th align="right" style="padding:3px 8px">People</th></tr>${rowsHtml}</table>`
      + `<p style="font-size:13px;color:#6b7280">${summary.unsubscribed_total} have asked us to stop in total`
      + `${stopsBy.size ? ` (${[...stopsBy].map(([c, n]) => `${c}: ${n}`).join(", ")})` : ""}. `
      + `This review exists because 33 students once received the same email nine times and nobody noticed until one of them complained.</p>`,
    { important: worry },
  );

  return NextResponse.json({ ...summary, emailed: true });
}
