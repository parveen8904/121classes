import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OfflineDownloads from "./OfflineDownloads";
import Help from "@/app/components/Help";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offline downloads — CA Parveen Sharma" };

export default async function DownloadsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/learn/downloads");

  // Classes the student may download (no keys returned here).
  const { data: classes } = await supabase.rpc("list_downloadable_classes");

  // Class numbers (from the section config) so the list reads "Class 12 · …".
  const { createServiceClient } = await import("@/lib/supabase/service");
  const svc = createServiceClient();
  const sectionIds = ((classes ?? []) as { section_id?: string }[]).map((c) => c.section_id).filter(Boolean) as string[];
  const classNoBySection = new Map<string, string>();
  if (sectionIds.length) {
    const { data: secs } = await svc.from("sections_meta").select("id, class_no").in("id", sectionIds);
    for (const s of secs ?? []) {
      const n = (s as { class_no?: string | null }).class_no;
      if (n) classNoBySection.set(s.id as string, String(n));
    }
  }
  const withNumbers = ((classes ?? []) as Record<string, unknown>[]).map((c) => ({
    ...c,
    class_no: classNoBySection.get((c.section_id as string) ?? "") ?? null,
  }));

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, role")
    .eq("id", user.id)
    .maybeSingle();
  const watermark = [profile?.full_name, user.email ?? profile?.phone].filter(Boolean).join(" · ");
  const isAdmin = profile?.role === "admin";

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <p className="crumb"><Link href="/dashboard">← Dashboard</Link></p>
        <div className="learn-hero">
        <span className="badge">📥 Offline</span>
        <h1>Download &amp; watch offline <Help text="Tap Download on a class to save it to this device, then Play offline anytime — no internet needed. Downloads continue in the background — you can lock the phone or leave the app. Videos are encrypted and show your name as a watermark." /></h1>
        <p className="meta">Save your classes to this device and play them without internet — encrypted &amp; watermarked. 🔐</p>
      </div>
      {/* Said plainly, and said HERE, because a student who discovers this in
          aeroplane mode on the train concludes the download failed. The licence
          check is the reason: a downloaded class is encrypted, and its key is
          only mirrored onto the device while there is a connection. */}
      <div className="notice" style={{ marginTop: 18, lineHeight: 1.65 }}>
        📶 <strong>Open this page once with internet before you travel.</strong> Your classes are stored encrypted,
        and this page has to collect the licence key for them while you are online — it takes a few seconds. After
        that they play in aeroplane mode, on a flight, anywhere, with no connection at all.
        <br />
        <span style={{ fontSize: ".88rem", opacity: 0.85 }}>
          If you downloaded a class and it will not play offline, come back online, open this page once, and it will
          work from then on.
        </span>
      </div>

      <div style={{ marginTop: 18 }}>
        <OfflineDownloads classes={withNumbers as never[]} watermark={watermark} isAdmin={isAdmin} />
      </div>
    </section>
  );
}
