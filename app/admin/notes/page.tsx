import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import { shareItem, saveItemSeo } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Free downloads (SEO) — Admin" };

// Which PDFs are given a public page, and what Google shows for each.

type Item = {
  id: string; title: string; kind: string; public_sample: boolean;
  share_slug: string | null; share_summary: string | null;
};

const KIND_LABEL: Record<string, string> = {
  past_papers: "Past paper", rtp: "RTP", mtp: "MTP",
  question_bank: "Question bank", notes: "Notes", icai: "ICAI material",
};

const SHOW_UNSHARED = 25;

export default async function AdminNotesPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim();
  const svc = createServiceClient();
  const { data } = await svc
    .from("repository_items")
    .select("id, title, kind, public_sample, share_slug, share_summary")
    .eq("is_active", true)
    .order("public_sample", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(400);
  const items = (data ?? []) as Item[];
  const shared = items.filter((i) => i.public_sample);
  const rest = items.filter((i) => !i.public_sample);
  // Searching looks through all of them; without a search, only the newest few.
  const needle = q.toLowerCase();
  const shownRest = needle
    ? rest.filter((i) => i.title.toLowerCase().includes(needle) || (KIND_LABEL[i.kind] ?? i.kind).toLowerCase().includes(needle))
    : rest.slice(0, SHOW_UNSHARED);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📄 Free downloads"
        title="Free downloads & their Google pages"
        subtitle="Every PDF you share gets a page on our own domain, so the search credit comes to us instead of the storage provider. 🔍"
        back={{ href: "/admin/campaigns", label: "Marketing" }}
      />

      <div className="card" style={{ marginTop: 16, fontSize: ".85rem" }}>
        <strong>Why the title matters more than anything here.</strong> The title is the blue line a student sees in
        Google. &ldquo;MAY 2025&rdquo; wins nothing; &ldquo;CA Final Financial Reporting — May 2025 question paper
        with solution&rdquo; is what they searched for. The summary is the grey line underneath it.
      </div>

      {/* ONE ROW PER FILE, NOT ONE FORM PER FILE.
          Every shared item rendered its full editing form — title, summary and
          address, three open boxes each — so twenty-six shared files made a
          page of seventy-eight input fields, and the heading of each card was
          its KIND, so the list read "Question paper, Question paper, Question
          paper" with the actual name hidden inside a text box.

          Now: the title is the row, and the form opens only when you want to
          change something. */}
      <h3 style={{ margin: "22px 0 8px" }}>🌐 Shared — {shared.length} live page(s)</h3>
      <div style={{ display: "grid", gap: 6 }}>
        {shared.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing shared yet.</p></div>}
        {shared.map((it) => (
          <div className="card" key={it.id} style={{ padding: "10px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ fontSize: ".95rem" }}>{it.title}</strong>
                <p className="muted" style={{ margin: "2px 0 0", fontSize: ".8rem" }}>
                  {KIND_LABEL[it.kind] ?? it.kind}
                  {it.share_slug ? ` · /notes/${it.share_slug}` : " · no address yet"}
                </p>
              </div>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {it.share_slug && (
                  <Link className="btn small secondary" href={`/notes/${it.share_slug}`} target="_blank">View ↗</Link>
                )}
                <form action={shareItem} style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={it.id} />
                  <input type="hidden" name="on" value="0" />
                  <SubmitButton className="btn small secondary">Stop sharing</SubmitButton>
                </form>
              </span>
            </div>

            {/* Closed until asked for. No script needed — a details element
                opens itself, which also keeps this page a server component. */}
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: ".82rem", color: "var(--accent)", fontWeight: 700 }}>
                ✏️ Edit what Google shows
              </summary>
              <form action={saveItemSeo} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={it.id} />
                <label style={{ fontSize: ".8rem" }}>Title — what Google shows</label>
                <input name="title" defaultValue={it.title} required />
                <label style={{ fontSize: ".8rem", marginTop: 6 }}>One-line summary</label>
                <input name="summary" defaultValue={it.share_summary ?? ""} placeholder="e.g. The full May 2025 CA Final FR paper, with the solution." />
                <label style={{ fontSize: ".8rem", marginTop: 6 }}>Address <span className="muted">— caparveensharma.com/notes/…</span></label>
                <input name="slug" defaultValue={it.share_slug ?? ""} />
                <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginTop: 8 }}>Save</SubmitButton>
              </form>
            </details>
          </div>
        ))}
      </div>

      {/* A HUNDRED AND SEVENTEEN ROWS IS NOT A LIST, IT IS A WALL.
          Nobody scrolls it looking for one paper. Search it, or see the newest
          few — and the count says plainly how many are not being shown. */}
      <h3 style={{ margin: "26px 0 8px" }}>Not shared ({rest.length})</h3>
      <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 10px" }}>
        Share only what you are happy to give away — each one becomes a public page. The file itself still asks for a
        login before it downloads.
      </p>

      <form style={{ display: "flex", gap: 8, maxWidth: 460, marginBottom: 12 }}>
        <input name="q" defaultValue={q} placeholder="🔍 Search by name…" style={{ marginBottom: 0 }} />
        <SubmitButton className="btn small" savedLabel="✓">Search</SubmitButton>
        {q && <a className="btn small secondary" href="/admin/notes">Clear</a>}
      </form>

      <div style={{ display: "grid", gap: 6 }}>
        {shownRest.length === 0 && (
          <div className="card"><p className="muted" style={{ margin: 0 }}>
            {q ? `Nothing matches “${q}”.` : "Everything is shared."}
          </p></div>
        )}
        {shownRest.map((it) => (
          <div className="list-row" key={it.id}>
            <div style={{ minWidth: 0 }}>
              <span className="row-title" style={{ fontWeight: 500 }}>{it.title}</span>
              <p className="row-sub">{KIND_LABEL[it.kind] ?? it.kind}</p>
            </div>
            <div className="row-actions">
              <form action={shareItem}>
                <input type="hidden" name="id" value={it.id} />
                <input type="hidden" name="on" value="1" />
                <SubmitButton className="btn small">Share it</SubmitButton>
              </form>
            </div>
          </div>
        ))}
      </div>

      {!q && rest.length > shownRest.length && (
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 12 }}>
          Showing the newest {shownRest.length} of {rest.length}. Search above for any of the others.
        </p>
      )}

    </section>
  );
}
