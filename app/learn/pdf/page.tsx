import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BackButton from "@/app/components/BackButton";
import NotesCanvas from "../notes/[sectionId]/NotesCanvas";

export const dynamic = "force-dynamic";

// In-app PDF viewer with a proper ← Back header — used for question papers,
// solutions and answer copies inside the mobile app, where a raw PDF view has
// no controls at all. The file still streams through /api/file (auth +
// allowlisted storage hosts only).
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
  if (!/^https:\/\//.test(raw)) redirect("/dashboard");
  const fileUrl = `/api/file?u=${encodeURIComponent(raw)}`;

  return (
    <main style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#111" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--card)", borderBottom: "1px solid var(--border)", paddingTop: "calc(10px + env(safe-area-inset-top))" }}>
        <BackButton />
        <strong style={{ fontSize: ".9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</strong>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <NotesCanvas fileUrl={fileUrl} />
      </div>
    </main>
  );
}
