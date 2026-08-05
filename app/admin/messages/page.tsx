import Link from "next/link";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — Admin" };

// One door for everything a student sends.
//
// The doubt inbox, the WhatsApp inbox and the doubt log were three separate
// tiles on the admin home, all for the same job — read what a student asked and
// answer it — so finding a message meant guessing which tile it had landed in.
// They are one tile now, and this page is what it opens: the three desks side
// by side, each with its own count, so you can see where the work is before you
// choose.
export default async function MessagesPage() {
  await assertArea("support");
  const svc = createServiceClient();

  const [doubts, waiting, wa, log] = await Promise.all([
    svc.from("doubts").select("id", { count: "exact", head: true }),
    svc.from("doubts").select("id", { count: "exact", head: true }).eq("status", "open"),
    svc.from("notifications").select("id", { count: "exact", head: true }).eq("channel", "whatsapp"),
    svc.from("doubts").select("id", { count: "exact", head: true }).eq("status", "answered"),
  ]).then((r) => r.map((x) => x.count ?? 0));

  const desks = [
    {
      href: "/admin/inbox",
      icon: "📥",
      title: "Doubt inbox",
      count: waiting,
      countLabel: waiting === 1 ? "waiting for you" : "waiting for you",
      desc: "Student doubts and page questions. Answer them, assign to faculty, or let the AI draft a reply first.",
    },
    {
      href: "/admin/whatsapp",
      icon: "💬",
      title: "WhatsApp",
      count: wa,
      countLabel: "messages",
      desc: "Messages students send to the business number, read and answered here — and where you connect your own number so students can keep writing to the one they already use.",
    },
    {
      href: "/admin/doubt-log",
      icon: "🗒️",
      title: "Answered log",
      count: log,
      countLabel: "answered",
      desc: "Every question a student asked and the answer that went back. Doubts are answered automatically now, so this is where you check whether the answers are good enough.",
    },
  ];

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📥 Messages"
        title="Everything students send you"
        subtitle={`${doubts} doubts on record. Three desks, one door — the inbox to answer, WhatsApp to reply on their own number, and the log to check what the AI has been saying.`}
        back={{ href: "/admin", label: "Admin" }}
      />

      <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
        {desks.map((d) => (
          <Link key={d.href} href={d.href} className="card" style={{ display: "block", textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: "1.05rem" }}>{d.icon} {d.title}</strong>
              <span style={{ marginLeft: "auto", fontWeight: 800, color: d.count ? "var(--accent)" : "var(--muted)" }}>
                {d.count} <span style={{ fontWeight: 400, fontSize: ".85rem" }}>{d.countLabel}</span>
              </span>
            </div>
            <p className="muted" style={{ fontSize: ".88rem", margin: "6px 0 0" }}>{d.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
