"use client";

// Sticky toolbar that acts on every ticked announcement at once. The row
// checkboxes live in the list but belong to this form via form="bulkForm"
// (the HTML `form` attribute), so we avoid nesting forms inside the per-row
// edit forms. Server actions are passed in from the page (server component).
export default function BulkBar({
  publish,
  unpublish,
  remove,
}: {
  publish: (fd: FormData) => void | Promise<void>;
  unpublish: (fd: FormData) => void | Promise<void>;
  remove: (fd: FormData) => void | Promise<void>;
}) {
  const checked = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked'));

  const toggleAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    document.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((cb) => (cb.checked = e.target.checked));
  };

  const guard = (e: React.MouseEvent) => {
    if (checked().length === 0) {
      e.preventDefault();
      window.alert("Tick at least one item first.");
    }
  };

  const confirmRemove = (e: React.MouseEvent) => {
    const n = checked().length;
    if (n === 0) {
      e.preventDefault();
      window.alert("Tick at least one item first.");
      return;
    }
    if (!window.confirm(`Remove ${n} selected item(s)? This cannot be undone.`)) e.preventDefault();
  };

  return (
    <form
      id="bulkForm"
      className="card"
      style={{
        position: "sticky",
        top: 8,
        zIndex: 5,
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        marginTop: 14,
        background: "var(--bg-soft, #f8fafc)",
      }}
    >
      <label className="remember" style={{ margin: 0, fontWeight: 600 }}>
        <input type="checkbox" onChange={toggleAll} /> Select all
      </label>
      <span className="muted" style={{ fontSize: ".8rem" }}>then:</span>
      <button className="btn small" type="submit" formAction={publish} onClick={guard}>✅ Publish</button>
      <button className="btn small secondary" type="submit" formAction={unpublish} onClick={guard}>⬜ Unpublish</button>
      <button className="btn small secondary" type="submit" formAction={remove} onClick={confirmRemove} style={{ marginLeft: "auto", color: "#b91c1c" }}>🗑️ Remove</button>
    </form>
  );
}
