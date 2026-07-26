import { createServiceClient } from "@/lib/supabase/service";
import { r2Configured } from "@/lib/r2";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { moveMaterials, removePublicCopies } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Storage — Admin" };

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Recursively total file sizes under a folder of the public `media` bucket.
async function folderSize(svc: ReturnType<typeof createServiceClient>, path: string, depth = 0): Promise<{ size: number; count: number }> {
  if (depth > 3) return { size: 0, count: 0 };
  const { data } = await svc.storage.from("media").list(path, { limit: 1000 });
  let size = 0, count = 0;
  for (const item of data ?? []) {
    const isFolder = (item as { id: string | null }).id === null;
    const child = path ? `${path}/${item.name}` : item.name;
    if (isFolder) {
      const sub = await folderSize(svc, child, depth + 1);
      size += sub.size; count += sub.count;
    } else {
      size += (item as { metadata?: { size?: number } }).metadata?.size ?? 0;
      count += 1;
    }
  }
  return { size, count };
}

export default async function StoragePage(props: {
  searchParams: Promise<{ moved?: string; already?: string; left?: string; failed?: string; why?: string; deleted?: string; stillthere?: string }>;
}) {
  const sp = await props.searchParams;
  const svc = createServiceClient();
  const [r2, root, secureList] = await Promise.all([
    r2Configured(),
    svc.storage.from("media").list("", { limit: 1000 }),
    svc.storage.from("secure").list("materials", { limit: 1000 }),
  ]);
  const movedSoFar = (secureList.data ?? []).length;

  // Per top-level folder + loose files
  const folders: { name: string; size: number; count: number }[] = [];
  let looseSize = 0, looseCount = 0;
  for (const item of root.data ?? []) {
    const isFolder = (item as { id: string | null }).id === null;
    if (isFolder) {
      const s = await folderSize(svc, item.name, 1);
      folders.push({ name: item.name, ...s });
    } else {
      looseSize += (item as { metadata?: { size?: number } }).metadata?.size ?? 0;
      looseCount += 1;
    }
  }
  if (looseCount) folders.push({ name: "(top level)", size: looseSize, count: looseCount });
  const total = folders.reduce((a, f) => a + f.size, 0);
  const totalFiles = folders.reduce((a, f) => a + f.count, 0);

  const FREE_GB = 1; // Supabase Free plan storage allowance
  const usedGB = total / 1024 / 1024 / 1024;
  const pct = Math.min(100, Math.round((usedGB / FREE_GB) * 100));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      {sp.moved !== undefined && (
        <div className={Number(sp.failed) > 0 ? "notice err" : "notice ok"} style={{ marginTop: 16 }}>
          Moved <strong>{sp.moved}</strong> file(s) behind login{Number(sp.already) > 0 ? `, ${sp.already} were already done` : ""}.
          {Number(sp.left) > 0
            ? <> About <strong>{sp.left}</strong> section(s) still to go — press the button again.</>
            : <> <strong>Nothing left to move.</strong></>}
          {Number(sp.failed) > 0 && <> {sp.failed} failed{sp.why ? `: ${sp.why}` : ""}.</>}
        </div>
      )}
      {sp.deleted !== undefined && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          Deleted <strong>{sp.deleted}</strong> public copy/copies. {sp.stillthere} file(s) remain in the public
          materials folder.
        </div>
      )}

      <AdminHero
        badge="🗄️ Storage"
        title="Storage usage"
        subtitle="How much your PDFs, images and other uploads are using. (Videos live on Bunny/YouTube — not counted here.)"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Paid material out of the public bucket */}
      <div className="form-card" style={{ marginTop: 18, borderLeft: "3px solid var(--accent)" }}>
        <h3 style={{ marginTop: 0 }}>🔒 Move class materials behind login</h3>
        <p className="muted" style={{ fontSize: ".85rem", margin: "0 0 10px" }}>
          Class notes and papers sit in the <strong>public</strong> folder, which means anyone holding the link can
          download them without signing in. This copies each one into the private area and points the site at the new
          copy — students see no difference, because their downloads already go through a login check. Safe to press
          repeatedly: it works in batches and skips whatever is already done.
        </p>
        <p style={{ fontSize: ".85rem", margin: "0 0 10px" }}>
          <strong>{movedSoFar}</strong> file(s) already moved to the private area.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <form action={moveMaterials}>
            <SubmitButton className="btn">Move the next batch →</SubmitButton>
          </form>
          <form action={removePublicCopies}>
            <SubmitButton className="btn secondary">Delete the public copies</SubmitButton>
          </form>
        </div>
        <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0 0" }}>
          Do the moving first, until it says nothing is left. Only then delete the public copies — that is what
          actually closes the door on links already shared.
        </p>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
          <strong style={{ fontSize: "1.4rem" }}>{human(total)}</strong>
          <span className="muted">{totalFiles} files · stored on {r2 ? "Cloudflare R2" : "Supabase"}</span>
        </div>
        {!r2 && (
          <>
            <div style={{ height: 10, background: "var(--bg-soft)", borderRadius: 999, marginTop: 12, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: pct > 85 ? "#ef4444" : "var(--accent)" }} />
            </div>
            <p className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>
              About {pct}% of the {FREE_GB} GB free Supabase allowance. {pct > 85 ? "Getting full — consider switching to Cloudflare R2 below." : "Plenty of room."}
            </p>
          </>
        )}
      </div>

      <h3 style={{ marginTop: 24 }}>By folder</h3>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {folders.length === 0 ? (
          <p className="muted">No uploaded files yet.</p>
        ) : (
          folders.sort((a, b) => b.size - a.size).map((f) => (
            <div className="list-row" key={f.name}>
              <div><span className="row-title">📁 {f.name}</span><p className="row-sub">{f.count} files</p></div>
              <strong>{human(f.size)}</strong>
            </div>
          ))
        )}
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <p className="muted" style={{ fontSize: ".84rem", margin: 0 }}>
          💡 PDFs and images are small, so this usually stays free. If it fills up, switch new uploads to
          <strong> Cloudflare R2</strong> (10 GB free, free bandwidth) from <strong>Integrations</strong> — your existing files keep working.
        </p>
      </div>
    </section>
  );
}
