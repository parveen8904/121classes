import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatINR } from "@/lib/pricing";
import { razorpayConfigured } from "@/lib/razorpay";
import BookCheckout from "./BookCheckout";

export const dynamic = "force-dynamic";

export default async function BookDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: book } = await supabase
    .from("books")
    .select("id, title, author, description, cover_url, price_inr, stock_qty, is_active")
    .eq("id", params.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!book) notFound();

  return (
    <section className="section" style={{ maxWidth: 980 }}>
      <p className="crumb">
        <Link href="/books">← Back to book store</Link>
      </p>

      <div className="studio" style={{ marginTop: 10 }}>
        <div className="imgph" style={{ minHeight: 360 }}>
          {book.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.cover_url}
              alt={book.title}
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 16 }}
            />
          ) : (
            <span className="em">📘</span>
          )}
        </div>
        <div>
          <h1 style={{ fontSize: "1.8rem" }}>{book.title}</h1>
          {book.author && <p className="muted" style={{ marginTop: 4 }}>by {book.author}</p>}
          <p className="price" style={{ fontSize: "1.5rem", margin: "12px 0" }}>
            {formatINR(book.price_inr)}
          </p>
          {book.description && <p style={{ marginBottom: 12 }}>{book.description}</p>}
          <p className="muted" style={{ fontSize: ".85rem" }}>
            {book.stock_qty > 0 ? "✅ In stock" : "⏳ Out of stock"} · 🚚 Free shipping
          </p>
        </div>
      </div>

      <div style={{ marginTop: 28, maxWidth: 620 }}>
        <BookCheckout
          bookId={book.id}
          inStock={book.stock_qty > 0}
          configured={razorpayConfigured()}
        />
      </div>
    </section>
  );
}
