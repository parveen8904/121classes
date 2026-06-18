import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../_components/DeleteButton";
import AdminHero from "../_components/AdminHero";
import ImageUpload from "../_components/ImageUpload";
import { createFaculty, updateFaculty, deleteFaculty } from "./actions";

export default async function FacultyPage() {
  const supabase = createClient();
  const { data: faculties } = await supabase
    .from("faculties")
    .select("id, full_name, photo_url, bio")
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
          <label htmlFor="f-bio">Bio (optional)</label>
          <textarea id="f-bio" name="bio" rows={3} placeholder="Short bio shown to students" />
          <button className="btn" type="submit">
            Add faculty
          </button>
        </form>
      </div></div>
      </details>

      <div style={{ marginTop: 24, display: "grid", gap: 12 }}>
        {faculties && faculties.length > 0 ? (
          faculties.map((f) => (
            <div className="card" key={f.id}>
              <form action={updateFaculty}>
                <input type="hidden" name="id" value={f.id} />
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label>Full name</label>
                    <input name="full_name" defaultValue={f.full_name} required />
                  </div>
                  <ImageUpload name="photo_url" defaultValue={f.photo_url ?? ""} folder="faculty" label="Photo" />
                </div>
                <label>Bio</label>
                <textarea name="bio" rows={3} defaultValue={f.bio ?? ""} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn small" type="submit">
                    Save
                  </button>
                  <DeleteButton action={deleteFaculty} id={f.id} message="Delete this faculty member?" />
                </div>
              </form>
            </div>
          ))
        ) : (
          <p className="muted">No faculty yet. Add the first one above.</p>
        )}
      </div>
    </section>
  );
}
