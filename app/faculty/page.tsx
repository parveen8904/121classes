import { createClient } from "@/lib/supabase/server";
import { lightImg } from "@/lib/img";

export const dynamic = "force-dynamic";

export default async function FacultyPage() {
  const supabase = createClient();
  const { data: faculty } = await supabase
    .from("faculties")
    .select("id, full_name, photo_url, bio")
    .order("full_name");

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">👩‍🏫 Faculty</span>
        <h2>Meet the team</h2>
        <p>
          Led by <strong>CA Parveen Sharma</strong> — one of India&apos;s most renowned Accountancy
          educators — and his handpicked faculty.
        </p>
      </div>

      {faculty && faculty.length > 0 ? (
        <div className="grid grid-3">
          {faculty.map((f) => (
            <div className="tile" key={f.id} style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 110,
                  height: 110,
                  borderRadius: "50%",
                  margin: "0 auto 14px",
                  overflow: "hidden",
                  border: "2px solid var(--accent)",
                  background: "linear-gradient(135deg, rgba(13,148,136,.25), rgba(16,185,129,.25))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2.4rem",
                }}
              >
                {f.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={lightImg(f.photo_url, 256)} loading="lazy" decoding="async" alt={f.full_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  "👨‍🏫"
                )}
              </div>
              <h3 style={{ fontSize: "1.15rem" }}>{f.full_name}</h3>
              {f.bio && <p className="muted" style={{ fontSize: ".9rem", marginTop: 8 }}>{f.bio}</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ textAlign: "center" }}>Faculty profiles are coming soon.</p>
      )}
    </section>
  );
}
