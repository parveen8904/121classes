import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NotesCanvas from "./NotesCanvas";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  hand: "✍️ Handwritten notes",
  typed: "⌨️ Typed notes",
  pdf: "📄 Class notes",
  homework: "✅ Homework solutions",
};

// In-app notes viewer: the PDF streams through our own domain (no storage URL
// visible) and a MOVING watermark with the student's identity floats over it —
// so screenshots/screen-recordings identify who leaked them.
export default async function NotesViewer({
  params,
  searchParams,
}: {
  params: { sectionId: string };
  searchParams: { kind?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/notes/${params.sectionId}`);

  const kind = ["hand", "typed", "pdf", "homework"].includes(searchParams.kind ?? "") ? (searchParams.kind as string) : "hand";

  const [{ data: sec }, { data: prof }] = await Promise.all([
    supabase.from("sections").select("title, topic_id, config").eq("id", params.sectionId).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!sec) notFound();

  const wm = [prof?.full_name, user.email, user.id.slice(0, 8)].filter(Boolean).join(" · ");
  const fileUrl = `/learn/notes/${params.sectionId}/file?kind=${kind}`;

  return (
    <main style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#111" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", background: "var(--card)", borderBottom: "1px solid var(--border)", paddingTop: "calc(10px + env(safe-area-inset-top))" }}>
        <Link className="btn small secondary" href={`/learn/topic/${sec.topic_id}`}>← Back</Link>
        <strong style={{ fontSize: ".9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{KIND_LABEL[kind]} — {sec.title}</strong>
        <a className="btn small" href={`${fileUrl}&dl=1`}>⬇️ Download / Print</a>
      </div>

      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <NotesCanvas fileUrl={fileUrl} />
        {/* Moving student watermark — identifies the viewer on any capture. */}
        <div className="notes-wm" aria-hidden>
          {wm}
        </div>
        <div className="notes-wm notes-wm2" aria-hidden>
          {wm}
        </div>
      </div>

      <style>{`
        .notes-wm {
          position: absolute; left: 0; top: 18%;
          color: rgba(13,148,136,.4); font-weight: 700; font-size: 15px;
          white-space: nowrap; pointer-events: none; user-select: none;
          text-shadow: 0 1px 2px rgba(0,0,0,.35);
          animation: notesDrift 18s linear infinite;
          z-index: 5;
        }
        .notes-wm2 { top: 62%; animation-duration: 26s; animation-delay: -9s; }
        @keyframes notesDrift {
          0%   { transform: translateX(-40%) }
          100% { transform: translateX(110vw) }
        }
      `}</style>
    </main>
  );
}
