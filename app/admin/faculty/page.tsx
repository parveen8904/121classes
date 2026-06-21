import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../_components/DeleteButton";
import AdminHero from "../_components/AdminHero";
import ImageUpload from "../_components/ImageUpload";
import { createFaculty, updateFaculty, deleteFaculty } from "./actions";
import SubmitButton from "@/app/components/SubmitButton";

export default async function FacultyPage() {
  const supabase = createClient();
  const { data: faculties } = await supabase
    .from("faculties")
    .select("id, full_name, phone, email, photo_url, bio")
    .order("full_name");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="👩‍🏫 Faculty"
        title="Faculty"
        subtitle="Add faculty here, then assign them to subjects from each subject page. 🎓"
        back={{ href: "/admin", label: "Admin" }}
      />

      <details style={{ marginTop: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <summary className="btn as-btn">＋ New faculty</summary>
        <div style={{ marginTop: 12, width: "100%" }}><div className="form-card" style={{ marginTop: 24 }}>
        <h3>➕ Add faculty</h3>
        <form action={createFaculty}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label htmlFor="f-name">Full name</label>
              <input id="f-name" name="full_name" placeholder="e.g. CA Parveen Sharma" required />
            </div>
            <ImageUpload name="photo_url" folder="faculty" label="Photo (optional)" />
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label htmlFor="f-phone">Phone (optional)</label>
              <input id="f-phone" name="phone" type="tel" placeholder="e.g. 98765 43210" />
            </div>
            <div>
              <label htmlFor="f-email">Email (optional)</label>
              <input id="f-email" name="email" type="email" placeholder="e.g. name@example.com" />
            </div>
          </div>
          <label htmlFor="f-bio">Bio (optional)</label>
          <textarea id="f-bio" name="bio" rows={3} placeholder="Short bio shown to students" />
          <SubmitButton className="btn" savedLabel="✓ Added" closeDetails>Add faculty</SubmitButton>
        </form>
      </div></div>
      </details>

      <h2 className="admin-section-title">📋 All faculty ({(faculties ?? []).length})</h2>
      <p className="muted" style={{ fontSize: ".9rem" }}>Tap one to open and edit it; it collapses again after you save.</p>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {faculties && faculties.length > 0 ? (
          faculties.map((f) => (
            <details className="card" key={f.id}>
              <summary style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <strong>{f.full_name}</strong>
                <span className="muted" style={{ fontSize: ".82rem" }}>
                  {[f.phone, f.email].filter(Boolean).join(" · ") || "no contact yet"}
                </span>
              </summary>
              <form action={updateFaculty} style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={f.id} />
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label>Full name</label>
                    <input name="full_name" defaultValue={f.full_name} required />
                  </div>
                  <ImageUpload name="photo_url" defaultValue={f.photo_url ?? ""} folder="faculty" label="Photo" />
                </div>
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label>Phone</label>
                    <input name="phone" type="tel" defaultValue={f.phone ?? ""} placeholder="e.g. 98765 43210" />
                  </div>
                  <div>
                    <label>Email</label>
                    <input name="email" type="email" defaultValue={f.email ?? ""} placeholder="e.g. name@example.com" />
                  </div>
                </div>
                <label>Bio</label>
                <textarea name="bio" rows={3} defaultValue={f.bio ?? ""} />
                <div style={{ display: "flex", gap: 8 }}>
                  <SubmitButton className="btn small" closeDetails>Save</SubmitButton>
                  <DeleteButton action={deleteFaculty} id={f.id} message="Delete this faculty member?" />
                </div>
              </form>
            </details>
          ))
        ) : (
          <p className="muted">No faculty yet. Add the first one above.</p>
        )}
      </div>
    </section>
  );
}
