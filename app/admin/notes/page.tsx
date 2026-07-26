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

export default async function AdminNotesPage() {
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

      <h3 style={{ margin: "22px 0 8px" }}>🌐 Shared — {shared.length} live page(s)</h3>
      <div style={{ display: "grid", gap: 10 }}>
        {shared.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing shared yet.</p></div>}
        {shared.map((it) => (
          <div className="form-card" key={it.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <strong>{KIND_LABEL[it.kind] ?? it.kind}</strong>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {it.share_slug && (
                  <Link className="btn small secondary" href={`/notes/${it.share_slug}`} target="_blank">View page ↗</Link>
                )}
                <form action={shareItem} style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={it.id} />
                  <input type="hidden" name="on" value="0" />
                  <SubmitButton className="btn small secondary">Stop sharing</SubmitButton>
                </form>
              </span>
            </div>
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
          </div>
        ))}
      </div>

      <h3 style={{ margin: "24px 0 8px" }}>Not shared ({rest.length})</h3>
      <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 10px" }}>
        Share only what you are happy to give away — each one becomes a public page. The file itself still asks for a
        login before it downloads.
      </p>
      <div style={{ display: "grid", gap: 6 }}>
        {rest.map((it) => (
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
    </section>
  );
}
