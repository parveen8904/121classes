import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OfflineDownloads from "./OfflineDownloads";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offline downloads — 121 CA Classes" };

export default async function DownloadsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/learn/downloads");

  // Classes the student may download (no keys returned here).
  const { data: classes } = await supabase.rpc("list_downloadable_classes");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", user.id)
    .maybeSingle();
  const watermark = [profile?.full_name, user.email ?? profile?.phone].filter(Boolean).join(" · ");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <div className="learn-hero">
        <span className="badge">📥 Offline</span>
        <h1>Download &amp; watch offline</h1>
        <p className="meta">Save your classes to this device and play them without internet — encrypted &amp; watermarked. 🔐</p>
      </div>
      <div style={{ marginTop: 22 }}>
        <OfflineDownloads classes={(classes as never[]) ?? []} watermark={watermark} />
      </div>
    </section>
  );
}
