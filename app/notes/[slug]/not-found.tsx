import Link from "next/link";
import { tryServiceClient } from "@/lib/supabase/service";

// WHEN A NOTE HAS BEEN TAKEN DOWN.
//
// Three of these addresses are still in Google, and students still have them in
// WhatsApp forwards and their own bookmarks. Until now every one of them landed
// on the bare site-wide 404 — a dead end for a student who came looking for a
// paper.
//
// THE STATUS STAYS 404, DELIBERATELY. That is what tells Google the address is
// gone so it stops offering it, and it is the honest answer: the file is not
// here. Redirecting these to the notes list instead would look tidier and be
// worse — Google treats a redirect to a listing page as a soft 404 and can hold
// the dead address for longer, and the student would be left wondering whether
// they had clicked the right link at all.
//
// What changes is only what the person sees: what happened, and the notes that
// ARE here, so the visit is not wasted.

export const revalidate = 3600;

export default async function NoteNotFound() {
  const svc = tryServiceClient();
  const { data } = svc
    ? await svc
        .from("repository_items")
        .select("title, share_slug, share_summary")
        .not("share_slug", "is", null)
        .order("created_at", { ascending: false })
        .limit(6)
    : { data: null };
  const recent = (data ?? []) as { title: string; share_slug: string; share_summary: string | null }[];

  return (
    <main>
      <section className="container" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 680 }}>
        <h1 style={{ marginBottom: 6 }}>This one is no longer here</h1>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          The note or paper at this address has been taken down — usually because it applied to an attempt that has
          passed, or because a corrected version replaced it. Nothing is wrong with your link; there is simply nothing
          at the other end of it any more.
        </p>

        <p style={{ marginTop: 18 }}>
          <Link className="btn" href="/notes">📚 See everything that is available now</Link>
        </p>

        {recent.length > 0 && (
          <>
            <h2 style={{ fontSize: "1.05rem", marginTop: 28 }}>The most recent ones</h2>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {recent.map((r) => (
                <Link
                  key={r.share_slug}
                  href={`/notes/${r.share_slug}`}
                  className="card"
                  style={{ display: "block", color: "inherit", textDecoration: "none", padding: "10px 14px" }}
                >
                  <strong>{r.title}</strong>
                  {r.share_summary && (
                    <div className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>
                      {r.share_summary.slice(0, 140)}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </>
        )}

        <p className="muted" style={{ fontSize: ".84rem", marginTop: 24 }}>
          Looking for something specific and cannot find it? Ask on{" "}
          <Link className="grad" href="/support">the support page</Link> and a person will point you to it.
        </p>
      </section>
    </main>
  );
}
