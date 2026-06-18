import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import ImageUpload from "../_components/ImageUpload";
import DeleteButton from "../_components/DeleteButton";
import { createResult, updateResult, deleteResult } from "./actions";

export default async function ResultsAdminPage() {
  const supabase = createClient();
  const { data: results } = await supabase
    .from("results")
    .select("id, student_name, headline, attempt, marks, quote, photo_url, order_index, is_published")
    .order("order_index")
    .order("created_at", { ascending: false });

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🏆 Results"
        title="Results & rank-holders"
        subtitle="Showcase your toppers and successes — the #1 trust signal for CA students. 🥇"
        back={{ href: "/admin", label: "Admin" }}
      />

      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ New result</summary>
        <div style={{ marginTop: 12, width: "100%" }}><div className="form-card" style={{ marginTop: 24 }}>
        <h3>➕ Add a result</h3>
        <form action={createResult}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Student name</label>
              <input name="student_name" placeholder="e.g. Riya Mehta" required />
            </div>
            <div>
              <label>Headline (rank / achievement)</label>
              <input name="headline" placeholder="e.g. AIR 12 · CA Final" />
            </div>
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 0.6fr" }}>
            <div>
              <label>Attempt</label>
              <input name="attempt" placeholder="e.g. May 2026" />
            </div>
            <div>
              <label>Marks</label>
              <input name="marks" placeholder="e.g. 612 / 800" />
            </div>
            <div>
              <label>Order</label>
              <input name="order_index" type="number" defaultValue={0} />
            </div>
          </div>
          <label>Quote (optional)</label>
          <textarea name="quote" rows={2} placeholder="A line from the student…" />
          <ImageUpload name="photo_url" folder="results" label="Student photo (optional)" />
          <label className="remember" style={{ marginTop: 0 }}>
            <input type="checkbox" name="is_published" defaultChecked /> Published
          </label>
          <button className="btn" type="submit">
            Add result
          </button>
        </form>
      </div></div>
      </details>

      <h2 className="admin-section-title">🥇 All results</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {results && results.length > 0 ? (
          results.map((r) => (
            <div className="card" key={r.id}>
              <form action={updateResult}>
                <input type="hidden" name="id" value={r.id} />
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label>Student name</label>
                    <input name="student_name" defaultValue={r.student_name} required />
                  </div>
                  <div>
                    <label>Headline</label>
                    <input name="headline" defaultValue={r.headline ?? ""} />
                  </div>
                </div>
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 0.6fr" }}>
                  <div>
                    <label>Attempt</label>
                    <input name="attempt" defaultValue={r.attempt ?? ""} />
                  </div>
                  <div>
                    <label>Marks</label>
                    <input name="marks" defaultValue={r.marks ?? ""} />
                  </div>
                  <div>
                    <label>Order</label>
                    <input name="order_index" type="number" defaultValue={r.order_index} />
                  </div>
                </div>
                <label>Quote</label>
                <textarea name="quote" rows={2} defaultValue={r.quote ?? ""} />
                <ImageUpload name="photo_url" defaultValue={r.photo_url ?? ""} folder="results" label="Student photo" />
                <label className="remember" style={{ marginTop: 0 }}>
                  <input type="checkbox" name="is_published" defaultChecked={r.is_published} /> Published
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn small" type="submit">
                    Save
                  </button>
                  <DeleteButton action={deleteResult} id={r.id} message="Delete this result?" />
                </div>
              </form>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No results yet — add your first topper above.</p>
          </div>
        )}
      </div>
    </section>
  );
}
