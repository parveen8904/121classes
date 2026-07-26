import AdminHero from "../../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import DeleteButton from "../../_components/DeleteButton";
import { addFestival, deleteFestival, importFestivals, saveFestivals, upcomingFestivals } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Festival greetings — Admin" };

// The founder's own festival list. The calendar proposes; he decides.

const SOURCE_LABEL: Record<string, string> = {
  calendar: "Indian holiday calendar",
  builtin: "our own list",
  manual: "added by you",
};

const pretty = (d: string) =>
  new Date(`${d}T06:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "long", year: "numeric" });

export default async function FestivalsPage(props: { searchParams: Promise<{ imported?: string; saved?: string }> }) {
  const { imported, saved } = await props.searchParams;
  const days = await upcomingFestivals();
  const greeted = days.filter((d) => d.greet);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="🎉 Festivals"
        title="Festival greetings"
        subtitle="Which days we wish students on, and how big each one is. Tick what matters, untick what doesn't, rename anything, add your own. 🪔"
        back={{ href: "/admin/broadcasts", label: "Campaigns" }}
      />

      {imported && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          {Number(imported) > 0
            ? <>Added <strong>{imported} new date(s)</strong> from the calendar. Your existing choices were left untouched.</>
            : <>Nothing new to add — the list is already up to date.</>}
        </div>
      )}
      {saved && <div className="notice ok" style={{ marginTop: 16 }}>✓ Saved.</div>}

      {/* Where the dates come from */}
      <div className="card" style={{ marginTop: 16 }}>
        <strong>Where these dates come from</strong>
        <ul style={{ fontSize: ".85rem", margin: "8px 0 10px", paddingLeft: 20 }}>
          <li>
            <strong>Indian holiday calendar</strong> — Google&apos;s public{" "}
            <a href="https://calendar.google.com/calendar/embed?src=en.indian%23holiday%40group.v.calendar.google.com" target="_blank" rel="noopener noreferrer">
              &ldquo;Holidays in India&rdquo;
            </a>{" "}
            calendar, the same one your phone uses. Every community&apos;s festivals, always on the right date, updated
            by Google each year.
          </li>
          <li>
            <strong>Our own list</strong> — days the public calendars simply don&apos;t carry. Guru Purnima is the one
            that matters: it appears in neither Google calendar, so we keep the dates ourselves.
          </li>
          <li><strong>Added by you</strong> — anything else you want wished, below.</li>
        </ul>
        <form action={importFestivals} style={{ margin: 0 }}>
          <SubmitButton className="btn small">⤵️ Import / refresh from the calendar</SubmitButton>
        </form>
        <p className="muted" style={{ fontSize: ".78rem", margin: "6px 0 0" }}>
          Brings in the next fifteen months. Safe to press any time — dates already in your list are never changed.
        </p>
      </div>

      {/* Add your own */}
      <div className="form-card" style={{ marginTop: 14 }}>
        <strong>Add a date of your own</strong>
        <form action={addFestival} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
          <div>
            <label style={{ fontSize: ".8rem" }}>Date</label>
            <input type="date" name="on_date" required />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: ".8rem" }}>What is it?</label>
            <input name="name" placeholder="e.g. Our foundation day" required />
          </div>
          <label className="remember" style={{ margin: "0 0 8px" }}>
            <input type="checkbox" name="all_channels" /> Big day — every channel
          </label>
          <SubmitButton className="btn small" savedLabel="✓ Added" style={{ marginBottom: 4 }}>Add</SubmitButton>
        </form>
      </div>

      {/* The list */}
      <div className="form-card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <strong>The next year — {greeted.length} of {days.length} will be greeted</strong>
        </div>
        <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 12px" }}>
          <strong>Greet</strong> — we wish students that day. <strong>Every channel</strong> — a big day: all the
          accounts carry the greeting and nothing else goes out. Left unticked, a greeting goes to Telegram, Discord
          and Instagram only, and the other accounts carry the normal post.
        </p>

        {days.length === 0 ? (
          <p className="muted" style={{ fontSize: ".85rem" }}>
            Nothing here yet — press <strong>Import / refresh from the calendar</strong> above to bring in the year.
          </p>
        ) : (
          <form action={saveFestivals}>
            <div style={{ display: "grid", gap: 2 }}>
              {days.map((f) => (
                <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--border)", padding: "7px 0" }}>
                  <input type="hidden" name="id" value={f.id} />
                  <span style={{ minWidth: 170, fontSize: ".82rem", fontWeight: 600 }}>{pretty(f.on_date)}</span>
                  <input name={`name_${f.id}`} defaultValue={f.name} style={{ flex: 1, minWidth: 180, fontSize: ".85rem" }} />
                  <label className="remember" style={{ margin: 0, fontSize: ".8rem", whiteSpace: "nowrap" }}>
                    <input type="checkbox" name={`greet_${f.id}`} defaultChecked={f.greet} /> Greet
                  </label>
                  <label className="remember" style={{ margin: 0, fontSize: ".8rem", whiteSpace: "nowrap" }}>
                    <input type="checkbox" name={`all_${f.id}`} defaultChecked={f.all_channels} /> Every channel
                  </label>
                  <span className="muted" style={{ fontSize: ".72rem", minWidth: 120 }}>{SOURCE_LABEL[f.source] ?? f.source}</span>
                  <DeleteButton action={deleteFestival} id={f.id} message="Remove this date from the list?" />
                </div>
              ))}
            </div>
            <SubmitButton className="btn" savedLabel="✓ Saved" style={{ marginTop: 14 }}>Save the list</SubmitButton>
          </form>
        )}
      </div>
    </section>
  );
}
