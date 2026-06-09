import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../_components/DeleteButton";
import { createAnnouncement, updateAnnouncement, deleteAnnouncement } from "./actions";

const KINDS = [
  { value: "amendment", label: "Amendment" },
  { value: "whats_new", label: "What's new" },
  { value: "student_corner", label: "Student corner" },
  { value: "industry", label: "Industry" },
  { value: "macro", label: "Macro" },
];

function KindSelect({ name, value }: { name: string; value?: string }) {
  return (
    <select name={name} defaultValue={value ?? "whats_new"}>
      {KINDS.map((k) => (
        <option key={k.value} value={k.value}>
          {k.label}
        </option>
      ))}
    </select>
  );
}

export default async function AnnouncementsPage() {
  const supabase = createClient();
  const { data: items } = await supabase
    .from("announcements")
    .select("id, kind, title, body, link_url, is_published, published_at")
    .order("published_at", { ascending: false });

  return (
    <section className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <p className="muted" style={{ marginBottom: 8 }}>
        <Link className="muted" href="/admin">
          ← Admin
        </Link>
      </p>
      <h1 style={{ marginBottom: 6 }}>Announcements</h1>
      <p className="muted">Amendments, what&apos;s new, student corner, industry &amp; macro updates.</p>

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 14 }}>Add an announcement</h3>
        <form action={createAnnouncement}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 2fr" }}>
            <div>
              <label htmlFor="a-kind">Kind</label>
              <KindSelect name="kind" />
            </div>
            <div>
              <label htmlFor="a-title">Title</label>
              <input id="a-title" name="title" placeholder="Headline" required />
            </div>
          </div>
          <label htmlFor="a-body">Body (optional)</label>
          <textarea id="a-body" name="body" rows={3} placeholder="Details" />
          <label htmlFor="a-link">Link URL (optional)</label>
          <input id="a-link" name="link_url" placeholder="https://…" />
          <label className="remember" style={{ marginTop: 0 }}>
            <input type="checkbox" name="is_published" defaultChecked /> Published
          </label>
          <button className="btn" type="submit">
            Add announcement
          </button>
        </form>
      </div>

      <div style={{ marginTop: 24, display: "grid", gap: 12 }}>
        {items && items.length > 0 ? (
          items.map((a) => (
            <div className="card" key={a.id}>
              <form action={updateAnnouncement}>
                <input type="hidden" name="id" value={a.id} />
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 2fr" }}>
                  <div>
                    <label>Kind</label>
                    <KindSelect name="kind" value={a.kind} />
                  </div>
                  <div>
                    <label>Title</label>
                    <input name="title" defaultValue={a.title} required />
                  </div>
                </div>
                <label>Body</label>
                <textarea name="body" rows={3} defaultValue={a.body ?? ""} />
                <label>Link URL</label>
                <input name="link_url" defaultValue={a.link_url ?? ""} />
                <label className="remember" style={{ marginTop: 0 }}>
                  <input type="checkbox" name="is_published" defaultChecked={a.is_published} /> Published
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn small" type="submit">
                    Save
                  </button>
                  <DeleteButton action={deleteAnnouncement} id={a.id} message="Delete this announcement?" />
                </div>
              </form>
            </div>
          ))
        ) : (
          <p className="muted">No announcements yet. Add the first one above.</p>
        )}
      </div>
    </section>
  );
}
