import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatINR } from "@/lib/pricing";
import { lightImg } from "@/lib/img";
import { AddToCartButton, CartBar } from "./cartClient";

export const dynamic = "force-dynamic";

export default async function BookStore() {
  const supabase = createClient();
  const { data: books } = await supabase
    .from("books")
    .select("id, title, author, cover_url, price_inr, stock_qty, is_active")
    .eq("is_active", true)
    .order("title");

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">📦 Book store</span>
        <h2>Books by CA Parveen Sharma &amp; team</h2>
        <p>Free shipping across India 🚚 · Guest checkout — no account needed.</p>
      </div>

      {books && books.length > 0 ? (
        <div className="grid grid-4">
          {books.map((b) => (
            <div key={b.id} className="tile book" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <Link href={`/books/${b.id}`} style={{ color: "var(--text)", display: "block" }}>
                <div className="cover">
                  {b.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={lightImg(b.cover_url, 384)}
                      loading="lazy"
                      decoding="async"
                      alt={b.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }}
                    />
                  ) : (
                    "📘"
                  )}
                </div>
                <h3 style={{ fontSize: "1.05rem" }}>{b.title}</h3>
                {b.author && <p className="muted" style={{ fontSize: ".85rem" }}>{b.author}</p>}
                <p className="price" style={{ marginTop: 8 }}>
                  {formatINR(b.price_inr)}
                </p>
              </Link>
              <div style={{ marginTop: "auto", paddingTop: 10, display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
                <AddToCartButton bookId={b.id} inStock={b.stock_qty > 0} />
                <Link className="btn small secondary" href={`/books/${b.id}`}>Details</Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ textAlign: "center" }}>
          📭 No books available right now — please check back soon.
        </p>
      )}
      <CartBar />
    </section>
  );
}
