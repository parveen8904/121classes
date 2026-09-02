import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import { NEXT, isPastAttempt } from "@/lib/attempts";
import { attemptRank } from "@/app/learn/_lib/attempt";
import { closeOffAction, carryForwardAction, leaveOpenAction } from "./actions";

export const dynamic = "force-dynamic";

type Row = { id: string; title: string; kind?: string | null; valid_from_attempt: string | null; valid_to_attempt: string | null };

const KIND_LABEL: Record<string, string> = {
  custom: "Hitlist / custom", rtp: "RTP", mtp: "MTP", paper: "Past paper",
  notes: "Notes", book: "Book", other: "Other",
};

export default async function AttemptsPage(props: {
  searchParams: Promise<{ a?: string; msg?: string }>;
}) {
  const sp = await props.searchParams;
  const svc = createServiceClient();

  // Every attempt that anything is actually tagged with, newest first — so the
  // list is what exists, not a guess at what might.
  const [{ data: ri }, { data: subj }, { data: top }, { data: mocks }, { data: pass }] = await Promise.all([
    svc.from("repository_items").select("id, title, kind, valid_from_attempt, valid_to_attempt"),
    svc.from("subjects").select("id, title, valid_from_attempt, valid_to_attempt"),
    svc.from("topics").select("id, title, valid_from_attempt, valid_to_attempt"),
    svc.from("mock_papers").select("id, title, attempt_label"),
    svc.from("repository_passages").select("id, attempt"),
  ]);

  const all = [...(ri ?? []), ...(subj ?? []), ...(top ?? [])] as Row[];
  const attempts = Array.from(new Set([
    ...all.flatMap((r) => [r.valid_from_attempt, r.valid_to_attempt]),
    ...(mocks ?? []).map((m) => (m as { attempt_label: string | null }).attempt_label),
    ...(pass ?? []).map((p) => (p as { attempt: string | null }).attempt),
  ].filter((x): x is string => !!x && /\d{4}/.test(x))))
    .sort((a, b) => (attemptRank(b) ?? 0) - (attemptRank(a) ?? 0));

  // Default to the most recent attempt that has BEEN SAT — that is the one
  // with housekeeping outstanding.
  const attempt = sp.a || attempts.find((a) => isPastAttempt(a)) || attempts[0] || "";

  const openFor = (rows: Row[]) =>
    rows.filter((r) => r.valid_from_attempt === attempt && !r.valid_to_attempt);
  const closedFor = (rows: Row[]) =>
    rows.filter((r) => r.valid_to_attempt === attempt);

  const groups: { table: string; label: string; rows: Row[] }[] = [
    { table: "repository_items", label: "📚 Repository — hitlist, RTP, MTP, notes", rows: (ri ?? []) as Row[] },
    { table: "subjects", label: "📘 Subjects", rows: (subj ?? []) as Row[] },
    { table: "topics", label: "📄 Topics", rows: (top ?? []) as Row[] },
  ];
  const mockCount = (mocks ?? []).filter((m) => (m as { attempt_label: string | null }).attempt_label === attempt).length;
  const passCount = (pass ?? []).filter((p) => (p as { attempt: string | null }).attempt === attempt).length;
  const totalOpen = groups.reduce((n, g) => n + openFor(g.rows).length, 0);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📅 Attempts"
        title="After the exam"
        subtitle="Everything tagged with one attempt, and what should become of it."
        back={{ href: "/admin", label: "Admin" }}
      />

      {sp.msg && <div className="notice ok" style={{ marginTop: 16 }}>✅ {sp.msg}</div>}

      <div className="card" style={{ marginTop: 18 }}>
        <p style={{ margin: 0, fontSize: ".92rem", lineHeight: 1.75 }}>
          Content tagged <strong>from</strong> an attempt with <strong>no end</strong> goes on applying to every
          student after it — for ever. The September hitlist would be shown to a January student as though it were
          theirs. Closing it off does not delete anything: it stays readable as a past-attempt reference and simply
          stops being served as current.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: ".9rem" }}>Attempt:</strong>
        {attempts.map((a) => (
          <Link
            key={a}
            href={`/admin/attempts?a=${encodeURIComponent(a)}`}
            className={a === attempt ? "btn small" : "btn small secondary"}
          >
            {a}{isPastAttempt(a) ? " · sat" : ""}
          </Link>
        ))}
      </div>

      {totalOpen === 0 && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          Nothing tagged <strong>{attempt}</strong> is still open-ended. This attempt is tidy.
        </div>
      )}

      {groups.map((g) => {
        const open = openFor(g.rows);
        const closed = closedFor(g.rows);
        if (!open.length && !closed.length) return null;
        return (
          <div key={g.table} style={{ marginTop: 22 }}>
            <h2 className="admin-section-title">{g.label}</h2>

            {open.length > 0 && (
              <form style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <input type="hidden" name="table" value={g.table} />
                <input type="hidden" name="attempt" value={attempt} />
                <input type="hidden" name="to_attempt" value={NEXT.inter} />
                {open.map((r) => (
                  <div className="list-row" key={r.id}>
                    <div>
                      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: 0 }}>
                        <input type="checkbox" name="ids" value={r.id} defaultChecked style={{ marginTop: 4 }} />
                        <span>
                          <span className="row-title">{r.title}</span>
                          <p className="row-sub">
                            {r.kind ? `${KIND_LABEL[r.kind] ?? r.kind} · ` : ""}
                            from {r.valid_from_attempt} · <strong>no end — still applies to everyone</strong>
                          </p>
                        </span>
                      </label>
                    </div>
                  </div>
                ))}
                {/* Three submit buttons on one form, each with its own action —
                    the choice IS the button, so nothing is applied by picking a
                    dropdown and forgetting to save. */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="submit" formAction={closeOffAction} className="btn small">
                    🔒 Close off at {attempt}
                  </button>
                  <button type="submit" formAction={carryForwardAction} className="btn small secondary">
                    ➡️ Carry forward to {NEXT.inter}
                  </button>
                  <button type="submit" formAction={leaveOpenAction} className="btn small secondary">
                    ♾️ Leave open — applies to every attempt
                  </button>
                </div>
                <p className="muted" style={{ fontSize: ".8rem", margin: 0 }}>
                  Untick anything that should be treated differently, then press the treatment you want for the rest.
                </p>
              </form>
            )}

            {closed.length > 0 && (
              <p className="muted" style={{ fontSize: ".84rem", marginTop: 10 }}>
                🔒 Already closed off at {attempt}: {closed.map((r) => r.title).join(" · ")}
              </p>
            )}
          </div>
        );
      })}

      {(mockCount > 0 || passCount > 0) && (
        <div className="card" style={{ marginTop: 22 }}>
          <strong style={{ fontSize: ".9rem" }}>Historic by nature — nothing to decide</strong>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 6, lineHeight: 1.7 }}>
            {mockCount > 0 && <>{mockCount} mock paper(s) labelled {attempt}. </>}
            {passCount > 0 && <>{passCount} past-paper passage(s) for {attempt}. </>}
            These name the sitting they belong to, which is what makes them useful afterwards. Relabelling them
            would make them say something untrue. New mock papers default to {NEXT.inter}.
          </p>
        </div>
      )}
    </section>
  );
}
