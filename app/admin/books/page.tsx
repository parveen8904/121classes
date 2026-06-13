import { createClient } from "@/lib/supabase/server";
import { formatINR } from "@/lib/pricing";
import DeleteButton from "../_components/DeleteButton";
import AdminHero from "../_components/AdminHero";
import ImageUpload from "../_components/ImageUpload";
import { createBook, updateBook, deleteBook } from "./actions";

export default async function AdminBooksPage() {
  const supabase = createClient();
  const { data: books } = await supabase
    .from("books")
    .select("id, title, author, description, cover_url, price_inr, stock_qty, is_active")
    .order("title");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📦 Books"
        title="Book store"
        subtitle="Add the books you sell. Students buy them with free shipping & guest checkout. 📚"
        back={{ href: "/admin", label: "Admin" }}
      />

      <div className="form-card" style={{ marginTop: 24 }}>
        <h3>➕ Add a book</h3>
        <form action={createBook}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr" }}>
            <div>
              <label htmlFor="b-title">Title</label>
              <input id="b-title" name="title" placeholder="e.g. Advanced Accounting (Vol 1)" required />
            </div>
            <div>
              <label htmlFor="b-author">Author</label>
              <input id="b-author" name="author" placeholder="CA Parveen Sharma" />
            </div>
          </div>
          <label htmlFor="b-desc">Description</label>
          <textarea id="b-desc" name="description" rows={2} />
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label htmlFor="b-price">Price (₹)</label>
              <input id="b-price" name="price_inr" type="number" defaultValue={0} />
            </div>
            <div>
              <label htmlFor="b-stock">Stock</label>
              <input id="b-stock" name="stock_qty" type="number" defaultValue={0} />
            </div>
          </div>
          <ImageUpload name="cover_url" folder="books" label="Cover image (optional)" />
          <label className="remember" style={{ marginTop: 0 }}>
            <input type="checkbox" name="is_active" defaultChecked /> Active (visible in store)
          </label>
          <button className="btn" type="submit">
            Add book
          </button>
        </form>
      </div>

      <h2 className="admin-section-title">📚 All books</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {books && books.length > 0 ? (
          books.map((b) => (
            <div className="card" key={b.id}>
              <form action={updateBook}>
                <input type="hidden" name="id" value={b.id} />
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr" }}>
                  <div>
                    <label>Title</label>
                    <input name="title" defaultValue={b.title} required />
                  </div>
                  <div>
                    <label>Author</label>
                    <input name="author" defaultValue={b.author ?? ""} />
                  </div>
                </div>
                <label>Description</label>
                <textarea name="description" rows={2} defaultValue={b.description ?? ""} />
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label>Price (₹)</label>
                    <input name="price_inr" type="number" defaultValue={b.price_inr} />
                  </div>
                  <div>
                    <label>Stock</label>
                    <input name="stock_qty" type="number" defaultValue={b.stock_qty} />
                  </div>
                </div>
                <ImageUpload name="cover_url" defaultValue={b.cover_url ?? ""} folder="books" label="Cover image" />
                <label className="remember" style={{ marginTop: 0 }}>
                  <input type="checkbox" name="is_active" defaultChecked={b.is_active} /> Active
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="btn small" type="submit">
                    Save
                  </button>
                  <DeleteButton action={deleteBook} id={b.id} message="Delete this book?" />
                  <span className="muted" style={{ fontSize: ".8rem" }}>
                    {formatINR(b.price_inr)} · {b.stock_qty} in stock · {b.is_active ? "🟢 active" : "⚪ hidden"}
                  </span>
                </div>
              </form>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No books yet — add your first title above.</p>
          </div>
        )}
      </div>
    </section>
  );
}
