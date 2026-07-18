type Faculty = {
  id: string;
  full_name: string;
  hasPhone: boolean;
  email: string | null;
  photo_url: string | null;
};

// "Your faculty" — names + contact links, shown per SUBJECT (each subject can
// have different faculty). Only faculty who have a phone or email are listed.
// The phone NUMBER is never sent to the browser: the WhatsApp button goes
// through the /api/faculty-wa bridge, which looks the number up server-side
// and forwards into a chat.
export default function FacultyContacts({ faculty, title = "👩‍🏫 Your faculty" }: { faculty: Faculty[]; title?: string }) {
  const withContact = faculty.filter((f) => f.hasPhone || f.email);
  if (withContact.length === 0) return null;

  return (
    <>
      <h2 style={{ margin: "18px 0 10px", fontSize: "1.05rem" }}>{title}</h2>
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
              {f.hasPhone && (
                <a className="btn small" href={`/api/faculty-wa?faculty=${f.id}`} target="_blank" rel="noopener noreferrer"
                  style={{ background: "#25D366", color: "#fff" }}>💬 WhatsApp</a>
              )}
              {f.email && (
                <a className="btn small secondary" href={`mailto:${f.email}`}>✉️ Email</a>
              )}
            </div>
            {f.email && (
              <p className="muted" style={{ fontSize: ".8rem", margin: 0, wordBreak: "break-word" }}>{f.email}</p>
            )}
            {f.hasPhone && (
              <p className="muted" style={{ fontSize: ".78rem", margin: 0 }}>🙏 Please WhatsApp your message — kindly avoid calling.</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
