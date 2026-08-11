"use client";

import { useState } from "react";
import { FIELD_LABEL, AUTO_FIELDS } from "@/lib/campaignChannels";
import SubmitButton from "@/app/components/SubmitButton";
import { createSeries } from "./actions";

// MANY POSTS TO ONE PLACE, EACH ON ITS OWN DAY.
//
// The campaign wizard does the opposite: one message, fanned out to every
// channel at the same moment. That is right for an announcement and wrong for
// everything else — a week of X posts is seven different thoughts on seven
// different mornings, not one thought repeated.
//
// So this asks the two questions the other screen cannot: where is this going,
// and when does each one go. The dates are filled in for you from a start and
// a gap, because typing seven datetimes by hand is how somebody gives up on
// the third — but every one stays editable afterwards, because the whole point
// is that they are different posts.

const ORDER = [
  "to_twitter", "to_linkedin", "to_instagram", "to_facebook",
  "to_tg_channel", "to_tg_groups", "to_discord", "to_whatsapp",
  "to_youtube", "to_yt_video", "to_substack", "to_medium",
  "to_reddit", "to_quora", "to_google", "to_direct",
];

type Post = { body: string; when: string };

/** "2026-08-14T09:30" — the value a datetime-local input wants. */
function slotAt(startDate: string, time: string, dayOffset: number): string {
  const d = new Date(`${startDate}T${time}:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + dayOffset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function SeriesForm() {
  const [channels, setChannels] = useState<string[]>(["to_twitter"]);
  const [posts, setPosts] = useState<Post[]>(
    Array.from({ length: 7 }, (_, i) => ({ body: "", when: slotAt(today(), "09:30", i + 1) })),
  );
  const [startDate, setStartDate] = useState(today());
  const [time, setTime] = useState("09:30");
  const [gap, setGap] = useState(1);

  const toggle = (f: string) =>
    setChannels((c) => (c.includes(f) ? c.filter((x) => x !== f) : [...c, f]));

  const setPost = (i: number, patch: Partial<Post>) =>
    setPosts((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  /** Re-lay the dates from the start, gap and time. Wording is never touched. */
  function respaceDates() {
    setPosts((p) => p.map((x, i) => ({ ...x, when: slotAt(startDate, time, (i + 1) * gap) })));
  }

  const written = posts.filter((p) => p.body.trim()).length;

  return (
    <form action={createSeries}>
      {/* ── Where ───────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: "1.02rem" }}>1 · Where do these go?</h2>
        <p className="muted" style={{ fontSize: ".84rem", lineHeight: 1.7, marginTop: 0 }}>
          Every post in this run goes to the same place or places. For a different channel with different wording,
          make a second run — that is what this screen is for.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ORDER.filter((f) => FIELD_LABEL[f]).map((f) => {
            const on = channels.includes(f);
            return (
              <label
                key={f}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px",
                  border: `1.5px solid ${on ? "var(--accent)" : "var(--border)"}`,
                  background: on ? "rgba(13,148,136,.08)" : undefined,
                  borderRadius: 999, cursor: "pointer", fontSize: ".86rem", marginBottom: 0,
                }}
              >
                <input type="checkbox" name="channels" value={f} checked={on} onChange={() => toggle(f)} />
                {FIELD_LABEL[f]}
                {!AUTO_FIELDS.has(f) && <span className="muted" style={{ fontSize: ".72rem" }}>by hand</span>}
              </label>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: ".78rem", marginTop: 8, marginBottom: 0 }}>
          “by hand” means we cannot publish there ourselves — those arrive as a reminder with the text ready to paste.
        </p>
      </div>

      {/* ── When ────────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: "1.02rem" }}>2 · When?</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ fontSize: ".78rem" }}>Start from</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ marginBottom: 0 }} />
          </div>
          <div>
            <label style={{ fontSize: ".78rem" }}>At (IST)</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ marginBottom: 0 }} />
          </div>
          <div>
            <label style={{ fontSize: ".78rem" }}>One every</label>
            <select value={gap} onChange={(e) => setGap(Number(e.target.value))} style={{ marginBottom: 0 }}>
              <option value={1}>day</option>
              <option value={2}>2 days</option>
              <option value={3}>3 days</option>
              <option value={7}>week</option>
            </select>
          </div>
          <button className="btn small secondary" type="button" onClick={respaceDates}>
            Fill the dates in
          </button>
          <span className="muted" style={{ fontSize: ".8rem" }}>
            Each date stays editable below — this only saves you typing them.
          </span>
        </div>
      </div>

      {/* ── The posts ───────────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, fontSize: "1.02rem" }}>3 · The posts</h2>
          <span className="muted" style={{ fontSize: ".84rem" }}>{written} of {posts.length} written</span>
          <span style={{ flex: 1 }} />
          <button className="btn small secondary" type="button"
            onClick={() => setPosts((p) => [...p, { body: "", when: slotAt(startDate, time, (p.length + 1) * gap) }])}>
            + one more
          </button>
        </div>

        {posts.map((p, i) => (
          <div key={i} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
              <strong style={{ fontSize: ".9rem" }}>Post {i + 1}</strong>
              <input
                type="datetime-local"
                name={`when_${i}`}
                value={p.when}
                onChange={(e) => setPost(i, { when: e.target.value })}
                style={{ marginBottom: 0 }}
              />
              {posts.length > 1 && (
                <button className="btn small secondary" type="button" style={{ marginLeft: "auto" }}
                  onClick={() => setPosts((x) => x.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
            <textarea
              name={`body_${i}`}
              rows={3}
              value={p.body}
              onChange={(e) => setPost(i, { body: e.target.value })}
              placeholder={i === 0 ? "What this post says…" : ""}
              style={{ marginBottom: 0 }}
            />
          </div>
        ))}
      </div>

      {/* Empty posts are dropped on the server; the count travels with them. */}
      <input type="hidden" name="count" value={posts.length} />

      <div className="card" style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label htmlFor="sname" style={{ fontSize: ".78rem" }}>Name this run</label>
          <input id="sname" name="name" placeholder="e.g. FR revision week on X" style={{ marginBottom: 0 }} />
        </div>
        <SubmitButton className="btn" savedLabel="✓ Scheduled">
          Schedule {written || posts.length} post{(written || posts.length) === 1 ? "" : "s"}
        </SubmitButton>
      </div>
      <p className="muted" style={{ fontSize: ".8rem", lineHeight: 1.7, marginTop: 8 }}>
        They are saved as <strong>drafts</strong>. Nothing leaves until you approve them on the campaign screen —
        the same approval every other post goes through. Blank posts are ignored, so you can leave spare rows.
      </p>
    </form>
  );
}
