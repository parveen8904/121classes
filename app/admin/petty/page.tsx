import AdminHero from "../_components/AdminHero";
import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { formatINR } from "@/lib/pricing";
import { formatDate } from "@/lib/dates";
import SubmitButton from "@/app/components/SubmitButton";
import { uploadBillAction } from "./actions";
import Money from "@/app/components/Money";

export const dynamic = "force-dynamic";
export const metadata = { title: "My advances — Petty cash" };

// THE RECIPIENT'S OWN LEDGER. A team member who receives advances sees exactly
// one thing here: their running balance, their bills, and the upload form.
// Nothing of anyone else's; management lives on the Zoho hub.

const STATUS_LABEL: Record<string, string> = {
  pending: "⏳ waiting for accounts",
  approved: "✅ approved",
  rejected: "❌ rejected",
  failed: "⏳ waiting for accounts", // a posting hiccup is the office's problem, not theirs
};

export default async function PettyPage(props: { searchParams: Promise<{ msg?: string }> }) {
  await assertArea("petty");
  const sp = await props.searchParams;
  const staff = await currentStaff();
  const svc = createServiceClient();

  const { data: person } = staff
    ? await svc.from("petty_people").select("id, name").eq("profile_id", staff.id).eq("active", true).maybeSingle()
    : { data: null };

  if (!person) {
    return (
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 720 }}>
        <AdminHero badge="👛 Petty cash" title="My advances" subtitle="" back={{ href: "/admin", label: "Admin" }} />
        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted" style={{ margin: 0 }}>
            Your advance ledger is not set up yet. Ask the accounts team to add you on the Zoho hub.
          </p>
        </div>
      </section>
    );
  }

  const [{ data: advs }, { data: bills }] = await Promise.all([
    svc.from("petty_advances").select("adv_date, amount, status").eq("person_id", person.id).eq("status", "posted").order("adv_date", { ascending: false }),
    svc.from("petty_bills").select("id, bill_date, amount, purpose, status, note, created_at").eq("person_id", person.id).order("created_at", { ascending: false }),
  ]);
  const advanced = (advs ?? []).reduce((s, a) => s + Number(a.amount), 0);
  const spent = (bills ?? []).filter((b) => b.status === "approved").reduce((s, b) => s + Number(b.amount), 0);
  const balance = advanced - spent;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <AdminHero
        badge="👛 Petty cash"
        title={`My advances — ${person.name}`}
        subtitle="Upload each bill against your advance with its purpose. Once accounts approves it, your balance reduces; a new advance tops it back up."
        back={{ href: "/admin", label: "Admin" }}
      />

      {sp.msg && <div className="notice ok" style={{ marginTop: 14 }}>{sp.msg}</div>}

      <div className="admin-cards" style={{ marginTop: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <div className="admin-tile"><div className="tile-ic">💰</div><h3 style={{ fontSize: "1.3rem" }}>{formatINR(advanced)}</h3><p>advances received</p></div>
        <div className="admin-tile"><div className="tile-ic">🧾</div><h3 style={{ fontSize: "1.3rem" }}>{formatINR(spent)}</h3><p>bills approved</p></div>
        <div className="admin-tile"><div className="tile-ic">👛</div><h3 style={{ fontSize: "1.3rem" }}>{formatINR(balance)}</h3><p>closing balance with you</p></div>
      </div>

      <h2 className="admin-section-title" style={{ marginTop: 22 }}>📤 Submit a bill</h2>
      <form action={uploadBillAction} className="card">
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <div><label>Amount (₹)</label><input name="amount" type="number" step="0.01" min="1" required /></div>
          <div><label>Bill date</label><input name="bill_date" type="date" required /></div>
        </div>
        <label>Purpose — what was this spent on?</label>
        <input name="purpose" required placeholder="e.g. courier charges for August dispatches" />
        <label>Bill / receipt (photo or PDF)</label>
        <input type="file" name="file" accept="image/*,.pdf" style={{ marginBottom: 10 }} />
        <SubmitButton className="btn small" savedLabel="✓ Submitted">📤 Submit for approval</SubmitButton>
      </form>

      {(bills ?? []).length > 0 && (
        <>
          <h2 className="admin-section-title" style={{ marginTop: 22 }}>🧾 My bills</h2>
          <div style={{ display: "grid", gap: 6 }}>
            {(bills ?? []).map((b) => (
              <div className="card" key={b.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px" }}>
                <span style={{ fontSize: ".82rem" }}>{formatDate(b.bill_date)}</span>
                <Money n={Number(b.amount)} width={110} bold />
                <span style={{ flex: 1, minWidth: 160, fontSize: ".85rem" }}>{b.purpose}</span>
                <span style={{ fontSize: ".8rem", whiteSpace: "nowrap" }}>{STATUS_LABEL[b.status] ?? b.status}</span>
                {b.status === "rejected" && b.note && <span className="muted" style={{ fontSize: ".78rem" }}>{b.note}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {(advs ?? []).length > 0 && (
        <>
          <h2 className="admin-section-title" style={{ marginTop: 22 }}>💰 Advances received</h2>
          <div style={{ display: "grid", gap: 6 }}>
            {(advs ?? []).map((a, i) => (
              <div className="card" key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px" }}>
                <span style={{ fontSize: ".82rem" }}>{formatDate(a.adv_date)}</span>
                <Money n={Number(a.amount)} width={110} bold />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
