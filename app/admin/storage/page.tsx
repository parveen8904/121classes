import { createServiceClient } from "@/lib/supabase/service";
import { r2Configured } from "@/lib/r2";
import AdminHero from "../_components/AdminHero";

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

export default async function StoragePage() {
  const svc = createServiceClient();
  const [r2, root] = await Promise.all([
    r2Configured(),
    svc.storage.from("media").list("", { limit: 1000 }),
  ]);

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
      <AdminHero
        badge="🗄️ Storage"
        title="Storage usage"
        subtitle="How much your PDFs, images and other uploads are using. (Videos live on Bunny/YouTube — not counted here.)"
        back={{ href: "/admin", label: "Admin" }}
      />

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
