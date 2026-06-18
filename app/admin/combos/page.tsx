import { createClient } from "@/lib/supabase/server";
import { formatINR, DURATIONS, durationLabel } from "@/lib/pricing";
import AdminHero from "../_components/AdminHero";
import DeleteButton from "../_components/DeleteButton";
import { createCombo, deleteCombo, toggleCombo } from "./actions";

type CourseRow = { id: string; title: string; subjects: { id: string; title: string }[] };
type ComboRow = {
  id: string;
  title: string;
  price_inr: number;
  tier: string;
  months: number;
  is_active: boolean;
  combo_items: { subjects: { title: string } | null }[] | null;
};

export default async function CombosPage() {
  const supabase = createClient();
  const [{ data: courses }, { data: combos }] = await Promise.all([
    supabase.from("courses").select("id, title, subjects(id, title)").order("order_index"),
    supabase
      .from("combos")
      .select("id, title, price_inr, tier, months, is_active, combo_items(subjects(title))")
      .order("created_at", { ascending: false }),
  ]);
  const courseList = (courses ?? []) as unknown as CourseRow[];
  const comboList = (combos ?? []) as unknown as ComboRow[];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🎁 Combos"
        title="Combo bundles"
        subtitle="Bundle several subjects at one discounted price — like the competitors' combo packs. 📦"
        back={{ href: "/admin", label: "Admin" }}
      />

      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ New combo</summary>
        <div style={{ marginTop: 12, width: "100%" }}><div className="form-card" style={{ marginTop: 24 }}>
        <h3>➕ Create a combo</h3>
        <form action={createCombo}>
          <label>Title</label>
          <input name="title" placeholder="e.g. CA Inter — Both Groups Combo" required />
          <label>Description</label>
          <textarea name="description" rows={2} placeholder="What's included…" />
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div>
              <label>Price (₹)</label>
              <input name="price_inr" type="number" defaultValue={0} />
            </div>
            <div>
              <label>Tier granted</label>
              <select name="tier" defaultValue="gold">
                <option value="bronze">🥉 Bronze</option>
                <option value="silver">🥈 Silver</option>
                <option value="gold">🥇 Gold</option>
              </select>
            </div>
            <div>
              <label>Duration</label>
              <select name="months" defaultValue="6">
                {DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {durationLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label>Subjects included</label>
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
            {courseList.length > 0 ? (
              courseList.map((c) => (
                <div key={c.id} style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: ".9rem" }}>{c.title}</strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6 }}>
                    {(c.subjects ?? []).map((s) => (
                      <label key={s.id} className="remember" style={{ margin: 0 }}>
                        <input type="checkbox" name="subject_id" value={s.id} /> {s.title}
                      </label>
                    ))}
                    {(c.subjects ?? []).length === 0 && <span className="muted">no subjects</span>}
                  </div>
                </div>
              ))
            ) : (
              <span className="muted">Add courses & subjects first.</span>
            )}
          </div>

          <label className="remember" style={{ marginTop: 0 }}>
            <input type="checkbox" name="is_active" defaultChecked /> Active
          </label>
          <button className="btn" type="submit">
            Create combo
          </button>
        </form>
      </div></div>
      </details>

      <h2 className="admin-section-title">🎁 All combos</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {comboList.length > 0 ? (
          comboList.map((c) => (
            <div className="list-row" key={c.id}>
              <div>
                <span className="row-title">🎁 {c.title}</span>
                <p className="row-sub">
                  {formatINR(c.price_inr)} · {c.tier} · {durationLabel(c.months)} · {c.is_active ? "🟢 active" : "⚪ off"}
                  {" · "}
                  {(c.combo_items ?? []).map((i) => i.subjects?.title).filter(Boolean).join(", ") || "no subjects"}
                </p>
              </div>
              <div className="row-actions">
                <form action={toggleCombo} style={{ margin: 0 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="next" value={c.is_active ? "false" : "true"} />
                  <button className="btn small secondary" type="submit">
                    {c.is_active ? "Disable" : "Enable"}
                  </button>
                </form>
                <DeleteButton action={deleteCombo} id={c.id} message="Delete this combo?" />
              </div>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No combos yet — create your first bundle above.</p>
          </div>
        )}
      </div>
    </section>
  );
}
