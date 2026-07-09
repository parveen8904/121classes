import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BackButton from "@/app/components/BackButton";
import NotesCanvas from "../notes/[sectionId]/NotesCanvas";
import NotesActions from "../notes/[sectionId]/NotesActions";

export const dynamic = "force-dynamic";

// In-app PDF viewer with a proper ← Back header and Save/Share/Print — used for
// question papers, solutions and answer copies inside the mobile app, where a
// raw PDF view has no controls at all. External files stream through /api/file
// (auth + allowlisted storage hosts); internal /learn/... routes (MCQ paper /
// answer key) are served directly and carry their own access checks.
export default async function PdfViewerPage({
  searchParams,
}: {
  searchParams: { u?: string; t?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const raw = searchParams.u ?? "";
  const title = (searchParams.t ?? "Document").slice(0, 80);
  const internal = /^\/learn\//.test(raw);
  if (!internal && !/^https:\/\//.test(raw)) redirect("/dashboard");
  const fileUrl = internal ? raw : `/api/file?u=${encodeURIComponent(raw)}`;
  const sep = fileUrl.includes("?") ? "&" : "?";

  return (
    <main style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#111" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", background: "var(--card)", borderBottom: "1px solid var(--border)", paddingTop: "calc(10px + env(safe-area-inset-top))" }}>
        <BackButton />
        <strong style={{ fontSize: ".9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{title}</strong>
        {/* NotesActions appends &dl=1 — harmless for routes that ignore it. */}
        <NotesActions fileUrl={`${fileUrl}${sep}v=1`} title={title} />
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <NotesCanvas fileUrl={fileUrl} />
      </div>
    </main>
  );
}
