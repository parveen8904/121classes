// Floating WhatsApp + Call + Telegram buttons (bottom-right). Renders nothing
// until the admin sets contacts in Site images. Plain links — no client JS.
export default function FloatingSupport({
  whatsapp,
  phone,
  telegram,
}: {
  whatsapp?: string | null;
  phone?: string | null;
  telegram?: string | null;
}) {
  const wa = (whatsapp || "").replace(/\D/g, "");
  const ph = (phone || "").replace(/\D/g, "");
  const tg = (telegram || "").trim();
  if (!wa && !ph && !tg) return null;
  return (
    <div className="fab-stack">
      {tg && (
        <a
          className="fab"
          href={tg.startsWith("http") ? tg : `https://t.me/${tg.replace(/^@/, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Join our Telegram"
          style={{ background: "#229ED9" }}
        >
          ✈️
        </a>
      )}
      {wa && (
        <a
          className="fab"
          href={`https://wa.me/${wa}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat on WhatsApp"
          style={{ background: "#25D366" }}
        >
          💬
        </a>
      )}
      {ph && (
        <a
          className="fab"
          href={`tel:+${ph}`}
          aria-label="Call us"
          style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
        >
          📞
        </a>
      )}
    </div>
  );
}
