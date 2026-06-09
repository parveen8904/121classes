import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  createThread,
  createPost,
  toggleSolution,
  toggleResolved,
  deletePost,
  deleteThread,
} from "./actions";

export const dynamic = "force-dynamic";

type ThreadRow = {
  id: string;
  title: string;
  body: string | null;
  is_resolved: boolean;
  created_at: string;
  author_id: string;
  profiles: { full_name: string | null } | null;
};
type PostRow = {
  id: string;
  thread_id: string;
  body: string;
  pdf_url: string | null;
  video_ref: string | null;
  is_solution: boolean;
  created_at: string;
  author_id: string;
  profiles: { full_name: string | null } | null;
};

function authorName(p: { full_name: string | null } | null): string {
  return p?.full_name?.trim() || "Student";
}
function fmt(s: string): string {
  return new Date(s).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
}

export default async function DiscussionBoard({ params }: { params: { sectionId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/section/${params.sectionId}`);

  // RLS only returns this section if the user may access it (free or subscribed).
  const { data: section } = await supabase
    .from("sections")
    .select("id, title, type, topic_id")
    .eq("id", params.sectionId)
    .maybeSingle();
  if (!section) {
    // Locked or missing — bounce to the topic where the lock/upgrade shows.
    notFound();
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin";

  const { data: threadsData } = await supabase
    .from("discussion_threads")
    .select("id, title, body, is_resolved, created_at, author_id, profiles(full_name)")
    .eq("section_id", section.id)
    .order("created_at", { ascending: false });
  const threads = (threadsData ?? []) as unknown as ThreadRow[];

  const threadIds = threads.map((t) => t.id);
  const { data: postsData } = threadIds.length
    ? await supabase
        .from("discussion_posts")
        .select("id, thread_id, body, pdf_url, video_ref, is_solution, created_at, author_id, profiles(full_name)")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: true })
    : { data: [] as never[] };
  const posts = (postsData ?? []) as unknown as PostRow[];
  const postsByThread = new Map<string, PostRow[]>();
  for (const p of posts) {
    const arr = postsByThread.get(p.thread_id) ?? [];
    arr.push(p);
    postsByThread.set(p.thread_id, arr);
  }

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
        <p className="crumb">
          <Link href={`/learn/topic/${section.topic_id}`}>← Back to topic</Link>
        </p>
        <div className="learn-hero">
          <span className="badge">🗣️ Discussion</span>
          <h1>{section.title}</h1>
          <p className="meta">
            Ask anything from the resources. Staff and fellow students reply — solutions can include a
            PDF and a video reference.
          </p>
        </div>

        {/* New thread */}
        <div className="card" style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 14 }}>Start a discussion</h3>
          <form action={createThread}>
            <input type="hidden" name="section_id" value={section.id} />
            <label htmlFor="nt-title">Your question</label>
            <input id="nt-title" name="title" placeholder="e.g. How is goodwill treated in AS 24?" required />
            <label htmlFor="nt-body">Details (optional)</label>
            <textarea id="nt-body" name="body" rows={3} />
            <button className="btn" type="submit">
              Post question
            </button>
          </form>
        </div>

        {/* Threads */}
        <div style={{ marginTop: 24, display: "grid", gap: 18 }}>
          {threads.length === 0 && <p className="muted">No questions yet. Be the first to ask.</p>}
          {threads.map((t) => {
            const replies = postsByThread.get(t.id) ?? [];
            const canManageThread = isAdmin || t.author_id === user.id;
            return (
              <div className="card" key={t.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ fontSize: "1.12rem" }}>
                      {t.is_resolved && <span className="lock-badge" style={{ marginRight: 8 }}>✓ Resolved</span>}
                      {t.title}
                    </h3>
                    <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
                      {authorName(t.profiles)} · {fmt(t.created_at)}
                    </p>
                  </div>
                  {canManageThread && (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <form action={toggleResolved} style={{ margin: 0 }}>
                        <input type="hidden" name="section_id" value={section.id} />
                        <input type="hidden" name="thread_id" value={t.id} />
                        <input type="hidden" name="on" value={t.is_resolved ? "false" : "true"} />
                        <button className="btn small secondary" type="submit">
                          {t.is_resolved ? "Reopen" : "Mark resolved"}
                        </button>
                      </form>
                      <form action={deleteThread} style={{ margin: 0 }}>
                        <input type="hidden" name="section_id" value={section.id} />
                        <input type="hidden" name="thread_id" value={t.id} />
                        <button className="btn small secondary" type="submit">
                          Delete
                        </button>
                      </form>
                    </div>
                  )}
                </div>
                {t.body && <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{t.body}</p>}

                {/* Replies */}
                {replies.length > 0 && (
                  <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                    {replies.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          borderLeft: `3px solid ${r.is_solution ? "var(--accent)" : "var(--border)"}`,
                          paddingLeft: 14,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <p className="muted" style={{ fontSize: ".78rem" }}>
                            {authorName(r.profiles)} · {fmt(r.created_at)}
                            {r.is_solution && (
                              <span className="lock-badge" style={{ marginLeft: 8 }}>★ Solution</span>
                            )}
                          </p>
                          {(isAdmin || r.author_id === user.id) && (
                            <div style={{ display: "flex", gap: 6 }}>
                              {isAdmin && (
                                <form action={toggleSolution} style={{ margin: 0 }}>
                                  <input type="hidden" name="section_id" value={section.id} />
                                  <input type="hidden" name="post_id" value={r.id} />
                                  <input type="hidden" name="on" value={r.is_solution ? "false" : "true"} />
                                  <button className="btn small secondary" type="submit">
                                    {r.is_solution ? "Unmark" : "Mark solution"}
                                  </button>
                                </form>
                              )}
                              <form action={deletePost} style={{ margin: 0 }}>
                                <input type="hidden" name="section_id" value={section.id} />
                                <input type="hidden" name="post_id" value={r.id} />
                                <button className="btn small secondary" type="submit">
                                  Delete
                                </button>
                              </form>
                            </div>
                          )}
                        </div>
                        <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{r.body}</p>
                        <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                          {r.pdf_url && (
                            <a className="btn small" href={r.pdf_url} target="_blank" rel="noopener noreferrer">
                              📑 Solution PDF
                            </a>
                          )}
                          {r.video_ref && (
                            <span className="muted" style={{ fontSize: ".85rem" }}>
                              🎬 {r.video_ref}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply form */}
                <details style={{ marginTop: 14 }}>
                  <summary style={{ cursor: "pointer", color: "var(--accent)", fontSize: ".9rem" }}>
                    Reply
                  </summary>
                  <form action={createPost} style={{ marginTop: 12 }}>
                    <input type="hidden" name="section_id" value={section.id} />
                    <input type="hidden" name="thread_id" value={t.id} />
                    <label>Your reply</label>
                    <textarea name="body" rows={3} required />
                    {isAdmin && (
                      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                        <div>
                          <label>Solution PDF URL (optional)</label>
                          <input name="pdf_url" placeholder="https://…" />
                        </div>
                        <div>
                          <label>Video reference (optional)</label>
                          <input name="video_ref" placeholder="e.g. Video 7 @ 12:30" />
                        </div>
                      </div>
                    )}
                    <button className="btn small" type="submit">
                      Post reply
                    </button>
                  </form>
                </details>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
