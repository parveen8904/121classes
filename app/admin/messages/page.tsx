import Link from "next/link";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — Admin" };

// One door for everything a student sends.
//
// The doubt inbox and the WhatsApp inbox were separate tiles on the admin home,
// both for the same job — read what a student asked and answer it — so finding
// a message meant guessing which tile it had landed in. They are one tile now,
// and this page is what it opens.
//
// The doubt REPORT is not here. Reading is split from doing: this page is where
// work is done, and the record of what was asked and answered lives once, in
// Reports. It used to sit here as a third tile as well, which is how the same
// figures came to be quoted in two places and disagree.
export default async function MessagesPage() {
  await assertArea("inbox");
  const svc = createServiceClient();

  const [doubts, waiting, wa] = await Promise.all([
    svc.from("doubts").select("id", { count: "exact", head: true }),
    svc.from("doubts").select("id", { count: "exact", head: true }).eq("status", "open"),
    // Conversations only — the daily targets and reminders that ride on this
    // table are Telegram, and counting them here made the inbox look busier
    // than it is.
    svc.from("notifications").select("id", { count: "exact", head: true })
       .eq("channel", "whatsapp").in("template", ["inbound", "outbound"]),
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
  ];

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📥 Messages"
        title="Everything students send you"
        subtitle={`${doubts} doubts on record. Two desks, one door — the inbox to answer, and WhatsApp to reply on the number they already write to.`}
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
      <p className="muted" style={{ marginTop: 18, fontSize: ".85rem" }}>
        Looking for the record of what was asked and what went back? That is the{" "}
        <Link href="/admin/doubt-log">doubt report</Link>, under Reports — kept in one place so the
        numbers cannot disagree with themselves.
      </p>
    </section>
  );
}
