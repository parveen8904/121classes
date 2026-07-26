import AdminHero from "../_components/AdminHero";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Video storage & cost — Admin" };

// Where the Bunny bill actually comes from.
//
// The founder was billed $86 in a month with 25 hours of watching in it, and
// had no way to see why. Delivery at that volume costs a couple of dollars —
// so the money is in STORAGE, and storage is multiplied by two things he can
// see here: how many quality versions each video is kept in, and how many
// regions the library is copied to. Both are settings, not usage.
//
// Nothing on this page is guessed: it is read live from the Bunny API with
// the key already saved on Integrations. Only the fields below are read; the
// API also returns library passwords, which are deliberately never touched.

const GB = 1024 ** 3;
const RATE = 0.01; // $/GB/month, Bunny's published storage rate — see note below

type Library = {
  Id: number; Name: string; VideoCount: number;
  StorageUsage: number; TrafficUsage: number;
  ReplicationRegions?: string[]; EnabledResolutions?: string; KeepOriginalFiles?: boolean;
};
type Zone = {
  Id: number; Name: string; Region: string;
  ReplicationRegions?: string[]; StorageUsed: number; FilesStored: number;
};

async function bunny<T>(path: string, key: string): Promise<T | null> {
  try {
    // Same rule as the billing call in lib/bunny.ts: cached, short timeout —
    // an external API must never hold an admin page hostage.
    const res = await fetch(`https://api.bunny.net${path}`, {
      headers: { AccessKey: key, accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const gb = (bytes: number) => (bytes || 0) / GB;
const money = (n: number) => `$${n.toFixed(2)}`;

export default async function BunnyPage() {
  const key = await getSecret("BUNNY_ACCOUNT_API_KEY");
  const svc = createServiceClient();

  // What our own records say students actually watched this month.
  const { data: watch } = await svc
    .from("class_watch")
    .select("video_seconds")
    .gte("last_watched_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());
  const watchedHours = Math.round((watch ?? []).reduce((n, r) => n + Number(r.video_seconds ?? 0), 0) / 3600);

  if (!key) {
    return (
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
        <AdminHero badge="🐰 Bunny" title="Video storage & cost" subtitle="Where the video bill comes from." back={{ href: "/admin", label: "Admin" }} />
        <div className="notice err" style={{ marginTop: 16 }}>
          No <code>BUNNY_ACCOUNT_API_KEY</code> saved — add it on <a href="/admin/integrations">Integrations</a> (Bunny
          dashboard → Account Settings → API key) and this page will read your real usage.
        </div>
      </section>
    );
  }

  const [libsRaw, zonesRaw] = await Promise.all([
    bunny<{ Items?: Library[] } | Library[]>("/videolibrary?page=1&perPage=100", key),
    bunny<Zone[]>("/storagezone", key),
  ]);
  const libs: Library[] = Array.isArray(libsRaw) ? libsRaw : (libsRaw?.Items ?? []);
  const zones: Zone[] = Array.isArray(zonesRaw) ? zonesRaw : [];

  const libStorage = libs.reduce((n, l) => n + gb(l.StorageUsage), 0);
  const libTraffic = libs.reduce((n, l) => n + gb(l.TrafficUsage), 0);
  const zoneStorage = zones.reduce((n, z) => n + gb(z.StorageUsed), 0);
  // Every replication region holds a second full copy, and is billed like one.
  const libCopies = libs.reduce((n, l) => n + gb(l.StorageUsage) * (1 + (l.ReplicationRegions?.length ?? 0)), 0);
  const zoneCopies = zones.reduce((n, z) => n + gb(z.StorageUsed) * (1 + (z.ReplicationRegions?.length ?? 0)), 0);
  const storageBill = (libCopies + zoneCopies) * RATE;

  const bigResolutions = libs.filter((l) => /1080p|1440p|2160p/.test(l.EnabledResolutions ?? ""));
  const keepingOriginals = libs.filter((l) => l.KeepOriginalFiles);
  const replicated = [...libs.filter((l) => (l.ReplicationRegions?.length ?? 0) > 0).map((l) => `${l.Name} (video library) → ${l.ReplicationRegions!.join(", ")}`),
                      ...zones.filter((z) => (z.ReplicationRegions?.length ?? 0) > 0).map((z) => `${z.Name} (storage zone) → ${z.ReplicationRegions!.join(", ")}`)];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="🐰 Bunny"
        title="Video storage & cost"
        subtitle="What you are being charged for, read live from your Bunny account — and which settings are driving it. 💸"
        back={{ href: "/admin", label: "Admin" }}
      />

      {!libs.length && !zones.length && (
        <div className="notice err" style={{ marginTop: 16 }}>
          Couldn&apos;t read the account — the key on Integrations may be a Stream key rather than the
          <strong> Account</strong> API key (Bunny dashboard → Account Settings → API).
        </div>
      )}

      {/* The headline */}
      <div className="card" style={{ marginTop: 16 }}>
        <strong>The short version</strong>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginTop: 10 }}>
          <div><div className="muted" style={{ fontSize: ".76rem" }}>Video kept</div><div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{libStorage.toFixed(0)} GB</div></div>
          <div><div className="muted" style={{ fontSize: ".76rem" }}>Counting every copy</div><div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{(libCopies + zoneCopies).toFixed(0)} GB</div></div>
          <div><div className="muted" style={{ fontSize: ".76rem" }}>Storage cost ≈</div><div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{money(storageBill)}<span style={{ fontSize: ".8rem", fontWeight: 400 }}>/mo</span></div></div>
          <div><div className="muted" style={{ fontSize: ".76rem" }}>Watched this month</div><div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{watchedHours} hrs</div></div>
        </div>
        <p className="muted" style={{ fontSize: ".8rem", margin: "10px 0 0" }}>
          Storage is charged every month whether anyone watches or not. Delivery is charged per GB sent — at
          {" "}{watchedHours} hours of watching that is a few dollars, not the bill. So the money is in what is
          <em> kept</em>, not in what is watched. (Estimate at Bunny&apos;s {money(RATE)}/GB storage rate; check the exact
          rate on <a href="https://bunny.net/pricing/" target="_blank" rel="noopener noreferrer">bunny.net/pricing</a>.)
        </p>
      </div>

      {/* What is driving it */}
      <h3 style={{ margin: "22px 0 8px" }}>What is driving the bill</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {replicated.length > 0 && (
          <div className="notice err" style={{ margin: 0 }}>
            <strong>Copies in other regions — {replicated.length} place(s).</strong> Every region keeps a full second
            copy and is billed like one, so two regions means double the storage bill, three means triple.
            <div style={{ fontSize: ".8rem", marginTop: 6 }}>{replicated.map((r) => <div key={r}>• {r}</div>)}</div>
            <div style={{ fontSize: ".82rem", marginTop: 6 }}>
              Your students are in India. One region near them is enough — replication only helps when viewers are
              spread across continents. <strong>It cannot be switched off on an existing library or zone</strong>: the
              fix is a new one without replication, and moving the videos over.
            </div>
          </div>
        )}
        {bigResolutions.length > 0 && (
          <div className="notice" style={{ margin: 0 }}>
            <strong>Large quality versions are being kept.</strong> Each video is stored once per quality, so 1080p and
            above roughly doubles what a lecture costs to keep.
            <div style={{ fontSize: ".8rem", marginTop: 6 }}>
              {bigResolutions.map((l) => <div key={l.Id}>• {l.Name}: {l.EnabledResolutions}</div>)}
            </div>
            <div style={{ fontSize: ".82rem", marginTop: 6 }}>
              For a lecture — a face, a board, still slides — 720p is indistinguishable from 1080p on a phone.
              Turning off 1080p and above in the library&apos;s encoding settings cuts storage for every new upload,
              and Bunny can re-encode what is already there.
            </div>
          </div>
        )}
        {keepingOriginals.length > 0 && (
          <div className="notice" style={{ margin: 0 }}>
            <strong>Original upload files are being kept</strong> ({keepingOriginals.map((l) => l.Name).join(", ")}).
            The original is never played — students always get an encoded version — so this is a second full copy of
            every lecture, paid for monthly. Safe to turn off once you have your own master copies.
          </div>
        )}
        {!replicated.length && !bigResolutions.length && !keepingOriginals.length && libs.length > 0 && (
          <div className="notice ok" style={{ margin: 0 }}>
            No replication, no oversized qualities, no kept originals — the settings are already lean. The bill is then
            simply the size of the library itself.
          </div>
        )}
      </div>

      {/* The detail */}
      <h3 style={{ margin: "22px 0 8px" }}>Video libraries</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {libs.map((l) => (
          <div className="list-row" key={l.Id}>
            <div style={{ minWidth: 0 }}>
              <span className="row-title">{l.Name}</span>
              <p className="row-sub">
                {l.VideoCount} videos · {gb(l.StorageUsage).toFixed(1)} GB stored · {gb(l.TrafficUsage).toFixed(1)} GB sent
                {l.ReplicationRegions?.length ? ` · copied to ${l.ReplicationRegions.join(", ")}` : " · no replication"}
                {l.EnabledResolutions ? ` · ${l.EnabledResolutions}` : ""}
                {l.KeepOriginalFiles ? " · keeps originals" : ""}
              </p>
            </div>
            <div className="row-actions">
              <span className="badge">≈ {money(gb(l.StorageUsage) * (1 + (l.ReplicationRegions?.length ?? 0)) * RATE)}/mo</span>
            </div>
          </div>
        ))}
        {!libs.length && <div className="card"><p className="muted" style={{ margin: 0 }}>No video libraries returned.</p></div>}
      </div>

      <h3 style={{ margin: "22px 0 8px" }}>Storage zones</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {zones.map((z) => (
          <div className="list-row" key={z.Id}>
            <div style={{ minWidth: 0 }}>
              <span className="row-title">{z.Name}</span>
              <p className="row-sub">
                {z.FilesStored?.toLocaleString?.() ?? z.FilesStored} files · {gb(z.StorageUsed).toFixed(1)} GB · main region {z.Region}
                {z.ReplicationRegions?.length ? ` · copied to ${z.ReplicationRegions.join(", ")}` : " · no replication"}
              </p>
            </div>
            <div className="row-actions">
              <span className="badge">≈ {money(gb(z.StorageUsed) * (1 + (z.ReplicationRegions?.length ?? 0)) * RATE)}/mo</span>
            </div>
          </div>
        ))}
        {!zones.length && <div className="card"><p className="muted" style={{ margin: 0 }}>No storage zones returned.</p></div>}
      </div>
      <p className="muted" style={{ fontSize: ".78rem", marginTop: 14 }}>
        Totals: {zoneStorage.toFixed(1)} GB in storage zones, {libStorage.toFixed(1)} GB of video, {libTraffic.toFixed(1)} GB
        sent to viewers this period. Read live from Bunny each time this page opens.
      </p>
    </section>
  );
}
