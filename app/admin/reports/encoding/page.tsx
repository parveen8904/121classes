import { formatDateTime, formatTime } from "@/lib/dates";
import AdminHero from "../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { setPriority, runNow } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // the "Run now" button works inside this
export const metadata = { title: "Offline encoding queue — Admin" };

// What the encoder did, what it is about to do, and the two controls that were
// missing: put a class first, and run it now instead of tonight.
//
// This exists because the queue jammed for two days and nothing on any screen
// said so. 583 jobs pending, none running, and the only way to find out was to
// query the database by hand.

const IST = "Asia/Kolkata";
const when = (s: string | null) =>
  s ? formatDateTime(s) : "—";
const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`);

type Job = {
  id: string; section_id: string; resolution: string | null; status: string;
  bytes_total: number | null; bytes_done: number | null; error: string | null;
  priority: number | null; created_at: string; updated_at: string | null;
};

const th: React.CSSProperties = { padding: "7px 9px", textAlign: "left", color: "var(--muted)", whiteSpace: "nowrap", fontWeight: 700 };
const td: React.CSSProperties = { padding: "7px 9px", verticalAlign: "top" };

export default async function EncodingReport() {
  await assertArea(null);
  const svc = createServiceClient();

  const [{ data: jobRows }, { data: secRows }, { data: doneVideos }] = await Promise.all([
    svc.from("offline_jobs")
      .select("id, section_id, resolution, status, bytes_total, bytes_done, error, priority, created_at, updated_at")
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(4000),
    svc.from("sections").select("id, title, topic_id, class_no:config->>class_no, bunny:m_bunny_video_id, yt:config->>youtube_url").eq("type", "full_class_video").limit(4000),
    svc.from("protected_videos").select("section_id, resolution, byte_size, created_at").eq("is_published", true).limit(4000),
  ]);

  const jobs = (jobRows ?? []) as Job[];
  type Sec = { id: string; title: string; topic_id: string | null; class_no: string | null; bunny: string | null; yt: string | null };
  const sections = (secRows ?? []) as unknown as Sec[];
  const name = new Map(sections.map((s) => [s.id, `${s.class_no ? `Class ${s.class_no} · ` : ""}${s.title}`]));

  // CLASSES THAT CAN NEVER REACH THIS QUEUE.
  //
  // The queue only ever contains work it has been given, so a class with no
  // source file in Bunny is not "waiting" — it is invisible. Thirteen of them
  // sat outside the screen entirely, and from the founder's chair that reads as
  // "pending files are not showing in encoding". They are not pending. They
  // were never entered, and nothing said so.
  //
  // A YouTube link is not a substitute here: offline download needs our own
  // encrypted copy, and YouTube cannot give us one.
  const noSource = sections.filter((s) => !String(s.bunny ?? "").trim());

  const now = Date.now();
  const since = (h: number) => new Date(now - h * 3600_000).toISOString();
  const finished = ((doneVideos ?? []) as { section_id: string; resolution: string | null; byte_size: number | null; created_at: string }[]);
  const inWindow = (h: number) => finished.filter((v) => v.created_at > since(h));

  const last24 = inWindow(24);
  const last48 = inWindow(48).filter((v) => v.created_at <= since(24)); // "yesterday"
  const last7d = inWindow(24 * 7);

  const pending = jobs.filter((j) => j.status === "pending");
  const running = jobs.filter((j) => j.status === "running");
  const errored = jobs.filter((j) => j.status === "error");
  const urgent = pending.filter((j) => (j.priority ?? 0) > 0);

  // The encoder only works overnight; say so plainly with the real window.
  const hourIST = Number(formatTime(new Date()));
  const offPeakNow = hourIST >= 1 && hourIST < 5;

  const stat = (icon: string, big: string, label: string) => (
    <div className="admin-tile"><div className="tile-ic">{icon}</div><h3 style={{ fontSize: "1.5rem" }}>{big}</h3><p>{label}</p></div>
  );

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 1100 }}>
      <AdminHero
        badge="🎬 Encoding queue"
        title="What the encoder did, and what it will do next"
        subtitle="Every downloadable class is encrypted here first. This is the queue: what finished, what is waiting, what failed — and you can put a class first or run it now instead of tonight."
        back={{ href: "/admin/reports", label: "Reports" }}
      />

      <div className="admin-cards" style={{ marginTop: 16, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        {stat("✅", String(last24.length), "finished today")}
        {stat("🌙", String(last48.length), "finished yesterday")}
        {stat("📅", String(last7d.length), "finished this week")}
        {stat("⏳", String(pending.length), "waiting")}
        {stat("⚠️", String(errored.length), "failed")}
      </div>

      <div className="card" style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <strong>{offPeakNow ? "🌙 The encoder is working now." : "☀️ The encoder is asleep until 1:30 am."}</strong>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: ".84rem" }}>
            Encrypting a 2 GB class is heavy, so it normally runs only overnight while nobody is studying.
            {" "}If something is needed today, run one now — it takes about a minute per class.
          </p>
        </div>
        <form action={runNow}>
          <button className="btn small" type="submit">▶️ Run one now</button>
        </form>
      </div>

      {running.length > 0 && (
        <div className="notice ok" style={{ marginTop: 14, fontSize: ".85rem" }}>
          🔄 Working right now: {running.map((j) => name.get(j.section_id) ?? j.section_id).join(", ")}
        </div>
      )}

      {/* ── Finished ─────────────────────────────────────────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 30 }}>✅ Finished in the last 24 hours ({last24.length})</h2>
      {last24.length === 0 ? (
        <div className="card"><p className="muted">Nothing finished today. If that keeps happening, the queue is stuck — check the failures below.</p></div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
            <thead><tr><th style={th}>Class</th><th style={th}>Quality</th><th style={th}>Size</th><th style={th}>Finished</th></tr></thead>
            <tbody>
              {last24.slice(0, 60).map((v, i) => (
                <tr key={`${v.section_id}-${v.resolution}-${i}`} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td}>{name.get(v.section_id) ?? "—"}</td>
                  <td style={td}>{v.resolution ?? "720p"}</td>
                  <td style={td}>{gb(Number(v.byte_size) || 0)}</td>
                  <td style={td}>{when(v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Failures ─────────────────────────────────────────────────────── */}
      {errored.length > 0 && (
        <>
          <h2 className="admin-section-title" style={{ marginTop: 30 }}>⚠️ Failed ({errored.length})</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
              <thead><tr><th style={th}>Class</th><th style={th}>Quality</th><th style={th}>What went wrong</th><th style={th}>When</th></tr></thead>
              <tbody>
                {errored.map((j) => (
                  <tr key={j.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>{name.get(j.section_id) ?? "—"}</td>
                    <td style={td}>{j.resolution || "—"}</td>
                    <td style={{ ...td, color: "var(--bad)" }}>{j.error ?? "—"}</td>
                    <td style={td}>{when(j.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Not in the queue at all ──────────────────────────────────────── */}
      {noSource.length > 0 && (
        <>
          <h2 className="admin-section-title" style={{ marginTop: 30 }}>
            🚫 Not in the queue — no video to encode ({noSource.length})
          </h2>
          <p className="muted" style={{ fontSize: ".82rem", marginTop: -4, lineHeight: 1.7 }}>
            These classes have no file in Bunny, so there is nothing to encrypt and they will never appear in the
            waiting list above — they are not late, they were never entered. A YouTube link does not help here:
            an offline download needs our own encrypted copy, and YouTube cannot give us one.
            <strong> Students cannot download these classes.</strong> Upload the video to Bunny and it joins the
            queue on its own that night.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
              <thead><tr><th style={th}>Class</th><th style={th}>Plays online from</th><th style={th}>What is needed</th></tr></thead>
              <tbody>
                {noSource.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>{s.class_no ? `Class ${s.class_no} · ` : ""}{s.title}</td>
                    <td style={td}>
                      {String(s.yt ?? "").trim()
                        ? <span className="muted">YouTube</span>
                        : <strong style={{ color: "var(--bad)" }}>nothing — no video at all</strong>}
                    </td>
                    <td style={td}>
                      {s.topic_id
                        ? <a className="btn small secondary" href={`/admin/topics/${s.topic_id}`}>Open the class →</a>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Waiting ──────────────────────────────────────────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 30 }}>⏳ Waiting ({pending.length})</h2>
      <p className="muted" style={{ fontSize: ".82rem", marginTop: -4 }}>
        In the order they will be attempted. {urgent.length > 0 && <><strong>{urgent.length} marked urgent</strong> and will go first. </>}
        Marking a class urgent moves it to the front of the very next run.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
          <thead><tr>
            <th style={th}>#</th><th style={th}>Class</th><th style={th}>Quality</th>
            <th style={th}>Last tried</th><th style={th}>Waiting since</th><th style={th}>Order</th>
          </tr></thead>
          <tbody>
            {pending.length === 0 && (
              <tr><td style={td} colSpan={6}><span className="muted">Nothing waiting — every class has every quality prepared. 🎉</span></td></tr>
            )}
            {pending.slice(0, 200).map((j, i) => (
              <tr key={j.id} style={{ borderTop: "1px solid var(--border)", background: (j.priority ?? 0) > 0 ? "rgba(13,148,136,.07)" : undefined }}>
                <td style={td}>{i + 1}</td>
                <td style={td}>{(j.priority ?? 0) > 0 && "⭐ "}{name.get(j.section_id) ?? j.section_id}</td>
                <td style={td}>{j.resolution || <span className="muted">waiting on Bunny</span>}</td>
                <td style={td}>{when(j.updated_at)}</td>
                <td style={td}>{when(j.created_at)}</td>
                <td style={td}>
                  <form action={setPriority}>
                    <input type="hidden" name="sectionId" value={j.section_id} />
                    <input type="hidden" name="urgent" value={(j.priority ?? 0) > 0 ? "0" : "1"} />
                    <button className={`btn small ${(j.priority ?? 0) > 0 ? "secondary" : ""}`} type="submit">
                      {(j.priority ?? 0) > 0 ? "↓ Back in line" : "↑ Do this first"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pending.length > 200 && (
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 10 }}>
          Showing the first 200 of {pending.length}. The rest are in the same order behind them.
        </p>
      )}
    </section>
  );
}
