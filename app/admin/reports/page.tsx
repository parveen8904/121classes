import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { REPORTS } from "@/lib/adminNav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports — Admin" };

// Every report behind one door.
//
// The founder's point: the admin panel had grown to fifty-odd tiles, and a good
// number of them were not things you DO — they were things you READ. Server
// health sat under Settings, the doubt log was buried two clicks inside
// Messages, revenue was called "Reports" while being only the money, and there
// was no email report at all. So "open Reports and see how the business is
// doing" was not a thing you could do.
//
// This is that page. The reports themselves stay where they live; this gathers
// them, and the panel that used to carry them no longer does.

export default async function ReportsHub() {
  await assertArea(null);

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📊 Reports"
        title="How everything is doing"
        subtitle="Read-only. Every number the site keeps about the business, the students and the machinery — in one place."
        back={{ href: "/admin", label: "Admin" }}
      />

      <div className="admin-cards" style={{ marginTop: 20 }}>
        {REPORTS.map((r) => (
          <Link className="admin-tile" key={r.href} href={r.href} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="tile-ic">{r.icon}</div>
            <h3>{r.title}</h3>
            <p>{r.desc}</p>
          </Link>
        ))}
      </div>

      <p className="muted" style={{ fontSize: ".85rem", marginTop: 24 }}>
        Reports only read — nothing here changes anything. To act on what you find, the report links through to the
        page that does the work.
      </p>
    </section>
  );
}
