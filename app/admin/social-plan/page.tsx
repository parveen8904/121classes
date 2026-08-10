import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SubmitButton from "@/app/components/SubmitButton";
import { formatDate } from "@/lib/dates";
import {
  CHANNEL_LABEL, RHYTHM_IN_WORDS, WEEKDAY_NAMES,
  addDays, weekStart, weekdayOf, type Channel,
} from "@/lib/socialRhythm";
import { loadWeek, type StoredSlot } from "@/lib/socialIdeas";
import { planWeek, amendSlot, toggleSkip, scheduleSlot, scheduleWeek } from "./actions";

export const dynamic = "force-dynamic";

// THE COMING WEEK, RECOMMENDED — NOT DECIDED.
//
// The founder asked for a plan he could amend "as per my convenience", and that
// word is the whole design. Every slot arrives already filled in: the day, the
// time, the platforms, and a real subject drawn from something already written
// on this site. He changes what he wants changed, drops what he does not want,
// and only what survives is handed to the posting queue.
//
// Nothing on this page publishes. The furthest it goes is writing a DRAFT into
// the same queue the campaigns page uses, which still has its own approval step
// before anything leaves the building.

const KIND_LABEL: Record<string, string> = {
  longform: "Long-form",
  visual: "Picture",
  oneline: "One line",
  video: "Video",
  meeting: "Voice call",
};

function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

export default async function SocialPlanPage({
  searchParams,
}: { searchParams: Promise<{ week?: string }> }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/social-plan");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") redirect("/dashboard");

  const sp = await searchParams;
  // The COMING week by default, not this one. A plan for a week already half
  // gone is a report, and he asked for something to look at in advance.
  const today = new Date().toISOString().slice(0, 10);
  const week = weekStart(sp.week || addDays(today, 7));
  const slots = await loadWeek(week);

  const byDay = new Map<string, StoredSlot[]>();
  for (let i = 0; i < 7; i++) byDay.set(addDays(week, i), []);
  for (const s of slots) byDay.get(s.slot_date)?.push(s);

  const live = slots.filter((s) => s.status !== "skipped" && s.kind !== "meeting");
  const done = slots.filter((s) => s.status === "scheduled");

  return (
    <main>
      <section className="container" style={{ maxWidth: 1000, paddingTop: 20 }}>
        <p style={{ marginBottom: 6 }}>
          <Link className="muted" href="/admin/campaigns">← Marketing &amp; campaigns</Link>
        </p>
        <h1 style={{ marginTop: 0 }}>🗓️ The posting week</h1>
        <p className="muted" style={{ lineHeight: 1.7, maxWidth: 760 }}>
          This is a <strong>recommendation</strong> for the week beginning {formatDate(`${week}T06:00:00Z`)}.
          Every slot already has a subject taken from something published on this site. Change the wording, drop
          anything you do not want, then send what is left to the posting queue — where it still waits for the
          usual approval before it goes anywhere.
        </p>

        {/* The rhythm in his own terms, so the page can be checked against what
            he asked for without reading any code. */}
        <div className="card" style={{ marginTop: 14 }}>
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>The standing rhythm</h2>
          <div style={{ display: "grid", gap: 6 }}>
            {RHYTHM_IN_WORDS.map((r) => (
              <div key={r.what} style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: ".9rem" }}>
                <strong style={{ minWidth: 250 }}>{r.what}</strong>
                <span className="muted">{r.when}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: ".8rem", lineHeight: 1.6, marginTop: 10, marginBottom: 0 }}>
            On the voice call: a strict fifteen-day cycle walks off Saturday within one turn, because fifteen is not
            a multiple of seven. Saturday evening is the part that matters, so it is every <strong>second</strong> Saturday
            — fourteen days. Say the word and it can be made exactly fifteen days on whatever day that falls.
          </p>
        </div>

        {/* Which week, and getting one drawn up. */}
        <div className="card" style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link className="btn small secondary" href={`/admin/social-plan?week=${addDays(week, -7)}`}>← Previous week</Link>
          <Link className="btn small secondary" href={`/admin/social-plan?week=${addDays(week, 7)}`}>Next week →</Link>
          <span className="muted" style={{ fontSize: ".85rem" }}>
            {formatDate(`${week}T06:00:00Z`)} – {formatDate(`${addDays(week, 6)}T06:00:00Z`)}
          </span>
          <span style={{ flex: 1 }} />
          {slots.length === 0 ? (
            <form action={planWeek}>
              <input type="hidden" name="week" value={week} />
              <SubmitButton className="btn small" savedLabel="✓ Drawn up">Draw up this week</SubmitButton>
            </form>
          ) : (
            <>
              <form action={planWeek}>
                <input type="hidden" name="week" value={week} />
                <SubmitButton className="btn small secondary" savedLabel="✓ Filled in">Fill any gaps</SubmitButton>
              </form>
              {live.length > done.length && (
                <form action={scheduleWeek}>
                  <input type="hidden" name="week" value={week} />
                  <SubmitButton className="btn small" savedLabel="✓ Queued">
                    Send {live.length - done.length} to the queue
                  </SubmitButton>
                </form>
              )}
            </>
          )}
        </div>

        {slots.length === 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <p className="muted" style={{ margin: 0, lineHeight: 1.7 }}>
              Nothing drawn up for this week yet. Press <strong>Draw up this week</strong> and every slot will be
              filled with a subject from your own published articles — you can then change any of them.
            </p>
          </div>
        )}

        {/* ── The week, day by day ─────────────────────────────────────── */}
        {slots.length > 0 && Array.from(byDay.entries()).map(([date, daySlots]) => (
          <div key={date} style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: "1.02rem", marginBottom: 8 }}>
              {`${WEEKDAY_NAMES[weekdayOf(date)]}, ${formatDate(`${date}T06:00:00Z`)}`}
              {date === today && <span className="muted" style={{ fontWeight: 400, fontSize: ".85rem" }}> · today</span>}
            </h2>

            {daySlots.length === 0 && (
              <p className="muted" style={{ fontSize: ".85rem", margin: "0 0 6px 2px" }}>Nothing scheduled.</p>
            )}

            {daySlots.map((s) => {
              const skipped = s.status === "skipped";
              const queued = s.status === "scheduled";
              return (
                <div
                  key={s.id}
                  className="card"
                  style={{
                    marginBottom: 10,
                    opacity: skipped ? 0.55 : 1,
                    borderLeft: `4px solid ${queued ? "#16a34a" : skipped ? "var(--border)" : s.kind === "meeting" ? "#7c3aed" : "#eab308"}`,
                  }}
                >
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                    <strong>{timeLabel(s.slot_time)}</strong>
                    <span className="muted" style={{ fontSize: ".85rem" }}>{KIND_LABEL[s.kind] ?? s.kind}</span>
                    <span style={{ fontSize: ".82rem" }}>
                      {s.channels.map((c) => CHANNEL_LABEL[c as Channel] ?? c).join(" · ")}
                    </span>
                    <span style={{ flex: 1 }} />
                    {queued && <span style={{ fontSize: ".8rem", color: "#16a34a", fontWeight: 600 }}>✓ in the queue</span>}
                    {skipped && <span className="muted" style={{ fontSize: ".8rem" }}>dropped this week</span>}
                    {s.status === "amended" && !queued && (
                      <span className="muted" style={{ fontSize: ".8rem" }}>your wording</span>
                    )}
                  </div>

                  {queued ? (
                    <div style={{ marginTop: 8 }}>
                      <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{s.idea_title}</p>
                      <p className="muted" style={{ margin: 0, fontSize: ".85rem", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                        {s.idea_body}
                      </p>
                      <p style={{ marginTop: 8, marginBottom: 0 }}>
                        <Link className="btn small secondary" href="/admin/campaigns">Open it in the queue →</Link>
                      </p>
                    </div>
                  ) : (
                    <form action={amendSlot} style={{ marginTop: 8, display: "grid", gap: 8 }}>
                      <input type="hidden" name="id" value={s.id} />
                      <input
                        name="idea_title"
                        defaultValue={s.idea_title ?? ""}
                        placeholder="What this one is about"
                        style={{ marginBottom: 0, fontWeight: 600 }}
                      />
                      <textarea
                        name="idea_body"
                        rows={s.kind === "longform" ? 7 : 5}
                        defaultValue={s.idea_body ?? ""}
                        style={{ marginBottom: 0, fontSize: ".88rem", lineHeight: 1.6 }}
                      />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <SubmitButton className="btn small" savedLabel="✓ Saved">Save my wording</SubmitButton>

                        {/* Native buttons: two more actions on the same form,
                            each posting to its own server action. */}
                        <button className="btn small secondary" formAction={toggleSkip} name="to" value={skipped ? "keep" : "skip"}>
                          {skipped ? "Put it back" : "Not this week"}
                        </button>

                        {!skipped && s.kind !== "meeting" && (
                          <button className="btn small secondary" formAction={scheduleSlot}>
                            Send this one to the queue →
                          </button>
                        )}

                        {s.source_url && (
                          <a className="muted" href={s.source_url} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: ".8rem" }}>
                            read the article ↗
                          </a>
                        )}
                        {s.kind === "meeting" && (
                          <span className="muted" style={{ fontSize: ".8rem" }}>
                            nothing is published — this is a reminder to be there
                          </span>
                        )}
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </main>
  );
}
