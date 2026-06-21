type Faculty = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
};

// wa.me needs full international digits. Indian numbers are entered as 10 digits
// (sometimes with spaces) — strip non-digits and assume +91 when it's a bare 10.
function waHref(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const full = d.length === 10 ? `91${d}` : d;
  return `https://wa.me/${full}`;
}

// "Your faculty" — names + contact links, shown to students on the dashboard.
// Only faculty who have a phone or email are listed.
export default function FacultyContacts({ faculty }: { faculty: Faculty[] }) {
  const withContact = faculty.filter((f) => f.phone || f.email);
  if (withContact.length === 0) return null;

  return (
    <>
      <h2 style={{ margin: "32px 0 12px", fontSize: "1.2rem" }}>👩‍🏫 Your faculty</h2>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
        {withContact.map((f) => (
          <div key={f.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {f.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.photo_url} alt={f.full_name}
                  style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: "1.8rem" }}>👩‍🏫</span>
              )}
              <strong>{f.full_name}</strong>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {f.phone && (
                <a className="btn small" href={waHref(f.phone)} target="_blank" rel="noopener noreferrer"
                  style={{ background: "#25D366", color: "#fff" }}>💬 WhatsApp</a>
              )}
              {f.email && (
                <a className="btn small secondary" href={`mailto:${f.email}`}>✉️ Email</a>
              )}
            </div>
            <p className="muted" style={{ fontSize: ".8rem", margin: 0, wordBreak: "break-word" }}>
              {[f.phone, f.email].filter(Boolean).join(" · ")}
            </p>
            {f.phone && (
              <p className="muted" style={{ fontSize: ".78rem", margin: 0 }}>🙏 Please WhatsApp your message — kindly avoid calling.</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
