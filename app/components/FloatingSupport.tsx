// Floating WhatsApp + Call buttons (bottom-right). Renders nothing until the
// admin sets numbers in Site images. Plain links — no client JS needed.
export default function FloatingSupport({
  whatsapp,
  phone,
}: {
  whatsapp?: string | null;
  phone?: string | null;
}) {
  const wa = (whatsapp || "").replace(/\D/g, "");
  const ph = (phone || "").replace(/\D/g, "");
  if (!wa && !ph) return null;
  return (
    <div className="fab-stack">
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
