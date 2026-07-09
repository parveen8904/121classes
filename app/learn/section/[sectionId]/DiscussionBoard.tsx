import { createClient } from "@/lib/supabase/server";
import {
  createThread,
  createPost,
  toggleSolution,
  toggleResolved,
  deletePost,
  deleteThread,
} from "./actions";

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

// The reusable discussion board (no page chrome). Used full-page on the section
// route AND inline under a class (like comments). `returnPath` is revalidated
// after each action so the page it's embedded on refreshes.
export default async function DiscussionBoard({
  sectionId,
  userId,
  isAdmin,
  returnPath,
  promptLabel = "Your question",
  placeholder = "Ask anything about this class…",
}: {
  sectionId: string;
  userId: string;
  isAdmin: boolean;
  returnPath: string;
  promptLabel?: string;
  placeholder?: string;
}) {
  const supabase = createClient();

  const { data: threadsData } = await supabase
    .from("discussion_threads")
    .select("id, title, body, is_resolved, created_at, author_id, profiles(full_name)")
    .eq("section_id", sectionId)
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
    <div>
      <div className="card">
        <form action={createThread}>
          <input type="hidden" name="section_id" value={sectionId} />
          <input type="hidden" name="return_path" value={returnPath} />
          <label htmlFor={`nt-${sectionId}`}>{promptLabel}</label>
          <input id={`nt-${sectionId}`} name="title" placeholder={placeholder} required />
          <textarea name="body" rows={2} placeholder="Add details (optional)" />
          <button className="btn small" type="submit">
            Post
          </button>
        </form>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
        {threads.length === 0 && (
          <p className="muted" style={{ fontSize: ".9rem" }}>No comments yet — be the first.</p>
        )}
        {threads.map((t) => {
          const replies = postsByThread.get(t.id) ?? [];
          const canManageThread = isAdmin || t.author_id === userId;
          return (
            <div className="card" key={t.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <strong>
                    {t.is_resolved && <span className="lock-badge" style={{ marginRight: 8 }}>✓ Resolved</span>}
                    {t.title}
                  </strong>
                  <p className="muted" style={{ fontSize: ".78rem", marginTop: 4 }}>
                    {authorName(t.profiles)} · {fmt(t.created_at)}
                  </p>
                </div>
                {canManageThread && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {isAdmin && (
                      <form action={toggleResolved} style={{ margin: 0 }}>
                        <input type="hidden" name="section_id" value={sectionId} />
                        <input type="hidden" name="return_path" value={returnPath} />
                        <input type="hidden" name="thread_id" value={t.id} />
                        <input type="hidden" name="on" value={t.is_resolved ? "false" : "true"} />
                        <button className="btn small secondary" type="submit">
                          {t.is_resolved ? "Reopen" : "Resolve"}
                        </button>
                      </form>
                    )}
                    <form action={deleteThread} style={{ margin: 0 }}>
                      <input type="hidden" name="section_id" value={sectionId} />
                      <input type="hidden" name="return_path" value={returnPath} />
                      <input type="hidden" name="thread_id" value={t.id} />
                      <button className="btn small secondary" type="submit">
                        Delete
                      </button>
                    </form>
                  </div>
                )}
              </div>
              {t.body && <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{t.body}</p>}

              {replies.length > 0 && (
                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  {replies.map((r) => (
                    <div key={r.id} style={{ borderLeft: `3px solid ${r.is_solution ? "var(--accent)" : "var(--border)"}`, paddingLeft: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <p className="muted" style={{ fontSize: ".76rem" }}>
                          {authorName(r.profiles)} · {fmt(r.created_at)}
                          {r.is_solution && <span className="lock-badge" style={{ marginLeft: 8 }}>★ Solution</span>}
                        </p>
                        {(isAdmin || r.author_id === userId) && (
                          <div style={{ display: "flex", gap: 6 }}>
                            {isAdmin && (
                              <form action={toggleSolution} style={{ margin: 0 }}>
                                <input type="hidden" name="section_id" value={sectionId} />
                                <input type="hidden" name="return_path" value={returnPath} />
                                <input type="hidden" name="post_id" value={r.id} />
                                <input type="hidden" name="on" value={r.is_solution ? "false" : "true"} />
                                <button className="btn small secondary" type="submit">
                                  {r.is_solution ? "Unmark" : "Solution"}
                                </button>
                              </form>
                            )}
                            <form action={deletePost} style={{ margin: 0 }}>
                              <input type="hidden" name="section_id" value={sectionId} />
                              <input type="hidden" name="return_path" value={returnPath} />
                              <input type="hidden" name="post_id" value={r.id} />
                              <button className="btn small secondary" type="submit">
                                Delete
                              </button>
                            </form>
                          </div>
                        )}
                      </div>
                      <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{r.body}</p>
                      {r.pdf_url && (
                        <a className="btn small" href={`/learn/pdf?u=${encodeURIComponent(r.pdf_url)}&t=Attachment`} style={{ marginTop: 6 }}>
                          📑 Solution PDF
                        </a>
                      )}
                      {r.video_ref && <span className="muted" style={{ fontSize: ".85rem", marginLeft: 8 }}>🎬 {r.video_ref}</span>}
                    </div>
                  ))}
                </div>
              )}

              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", color: "var(--accent)", fontSize: ".9rem" }}>Reply</summary>
                <form action={createPost} style={{ marginTop: 10 }}>
                  <input type="hidden" name="section_id" value={sectionId} />
                  <input type="hidden" name="return_path" value={returnPath} />
                  <input type="hidden" name="thread_id" value={t.id} />
                  <textarea name="body" rows={2} placeholder="Write a reply…" required />
                  {isAdmin && (
                    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                      <input name="pdf_url" placeholder="Solution PDF URL (optional)" />
                      <input name="video_ref" placeholder="Video ref e.g. Video 7 @ 12:30" />
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
    </div>
  );
}
