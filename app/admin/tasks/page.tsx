import { formatDate, formatDateTime } from "@/lib/dates";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import AdminHero from "../_components/AdminHero";
import { createTasks, setTaskStatus, addRemark, forwardTask } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Office tasks — Admin" };

type Staff = { id: string; full_name: string | null; email: string | null; role: string };
type Task = {
  id: string; title: string; detail: string | null; status: string; priority: string;
  due_on: string | null; assignee_id: string | null; created_by: string | null; created_at: string;
};
type Event = { id: string; task_id: string; actor_id: string | null; kind: string; body: string | null; to_user_id: string | null; created_at: string };

const STATUS = {
  open: { label: "🔵 To do", colour: "#2563eb" },
  doing: { label: "🟡 In hand", colour: "#b45309" },
  done: { label: "🟢 Done", colour: "#16a34a" },
  cancelled: { label: "⚪ Dropped", colour: "var(--muted)" },
} as const;

function when(s: string | null): string {
  if (!s) return "";
  return formatDateTime(s);
}

// The office to-do list.
//
// The founder's words: he posts any number of items a person has to complete;
// it becomes their to-do list; they open it, see the detail, finish it, add a
// remark, or forward it to somebody else.
//
// So the page opens on MY TASKS, because the person reading it is nearly always
// the person who has to do something — the admin who assigns work is one reader,
// the four people doing it are the rest.
export default async function TasksPage(props: {
  searchParams: Promise<{ made?: string; err?: string; view?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/tasks");

  const { data: profile } = await supabase.from("profiles").select("id, role, full_name").eq("id", user.id).maybeSingle();
  if (!profile || !["admin", "faculty", "operator"].includes(String(profile.role))) redirect("/dashboard");
  const isAdmin = profile.role === "admin";

  const svc = createServiceClient();
  const [{ data: staffRows }, { data: taskRows }] = await Promise.all([
    svc.from("profiles").select("id, full_name, email, role").in("role", ["admin", "faculty", "operator"]).order("full_name"),
    svc.from("staff_tasks").select("*").order("created_at", { ascending: false }).limit(300),
  ]);
  const staff = (staffRows ?? []) as Staff[];
  const tasks = (taskRows ?? []) as Task[];

  const { data: eventRows } = tasks.length
    ? await svc.from("staff_task_events").select("*").in("task_id", tasks.map((t) => t.id)).order("created_at")
    : { data: [] as Event[] };
  const events = (eventRows ?? []) as Event[];
  const eventsByTask = new Map<string, Event[]>();
  for (const e of events) {
    if (!eventsByTask.has(e.task_id)) eventsByTask.set(e.task_id, []);
    eventsByTask.get(e.task_id)!.push(e);
  }

  const nameOf = new Map(staff.map((s) => [s.id, s.full_name || s.email || "Someone"]));
  const view = searchParams.view ?? "mine";
  const mine = tasks.filter((t) => t.assignee_id === profile.id);
  const openAll = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const listed =
    view === "all" ? tasks : view === "open" ? openAll : mine;

  const myOpen = mine.filter((t) => t.status !== "done" && t.status !== "cancelled").length;

  const TABS = [
    { key: "mine", label: "🙋 My tasks", n: myOpen },
    { key: "open", label: "📋 Everything open", n: openAll.length },
    { key: "all", label: "🗂️ All", n: tasks.length },
  ];

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="✅ Office tasks"
        title="Who is doing what"
        subtitle="Post a job, it lands on someone's list. They finish it, add a note, or pass it on — and every hand-off stays on the record."
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.made && <div className="notice ok" style={{ marginTop: 16 }}>✅ {searchParams.made} task(s) posted.</div>}
      {searchParams.err && <div className="notice err" style={{ marginTop: 16 }}>{searchParams.err}</div>}

      {/* Only an admin hands out work. */}
      {isAdmin && (
        <form action={createTasks} className="card" style={{ marginTop: 16 }}>
          <strong>➕ Post tasks</strong>
          <p className="muted" style={{ fontSize: ".84rem", margin: "4px 0 10px" }}>
            One task per line — paste a list of eight and you get eight tasks, all to the same person.
          </p>
          <textarea
            name="titles"
            rows={4}
            required
            placeholder={"Call the students who did not renew\nSend the AS 25 answer key to print\nCheck yesterday's fee receipts"}
            style={{ width: "100%" }}
          />
          <textarea name="detail" rows={2} placeholder="Detail (optional) — anything they need to do it" style={{ width: "100%", marginTop: 8 }} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, alignItems: "end" }}>
            <div>
              <label style={{ fontSize: ".82rem" }}>To</label>
              <select name="assignee_id" required style={{ minWidth: 190 }}>
                <option value="">Choose a person…</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name || s.email} ({s.role})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: ".82rem" }}>Priority</label>
              <select name="priority" defaultValue="normal">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: ".82rem" }}>Due (optional)</label>
              <input type="date" name="due_on" />
            </div>
            <SubmitButton className="btn" savedLabel="Posted">Post</SubmitButton>
          </div>
        </form>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0 12px" }}>
        {TABS.map((t) => (
          <a key={t.key} className={`btn small ${view === t.key ? "" : "secondary"}`} href={`/admin/tasks?view=${t.key}`}>
            {t.label} ({t.n})
          </a>
        ))}
      </div>

      {listed.length === 0 ? (
        <div className="card"><p className="muted">Nothing here. 🎉</p></div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {listed.map((t) => {
            const st = STATUS[(t.status as keyof typeof STATUS)] ?? STATUS.open;
            const hist = eventsByTask.get(t.id) ?? [];
            const overdue = t.due_on && t.status !== "done" && new Date(t.due_on) < new Date();
            return (
              <details key={t.id} className="card" style={{ borderLeft: `4px solid ${st.colour}` }}>
                <summary style={{ cursor: "pointer", listStyle: "none" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "1rem" }}>{t.priority === "high" ? "🔴 " : ""}{t.title}</strong>
                    <span style={{ color: st.colour, fontWeight: 700, fontSize: ".8rem" }}>{st.label}</span>
                    <span className="muted" style={{ fontSize: ".8rem", marginLeft: "auto" }}>
                      {t.assignee_id ? `with ${nameOf.get(t.assignee_id) ?? "someone"}` : "unassigned"}
                      {t.due_on ? ` · due ${formatDate(t.due_on)}` : ""}
                      {overdue ? " ⚠️ overdue" : ""}
                    </span>
                  </div>
                </summary>

                {t.detail && <p style={{ fontSize: ".92rem", margin: "10px 0 0", whiteSpace: "pre-wrap" }}>{t.detail}</p>}

                {/* What has happened to it. A forwarded job with no author is
                    how work goes missing in an office. */}
                {hist.length > 0 && (
                  <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: ".82rem", lineHeight: 1.7 }}>
                    {hist.map((e) => (
                      <li key={e.id} className="muted">
                        <strong>{nameOf.get(e.actor_id ?? "") ?? "Someone"}</strong>{" "}
                        {e.kind === "created" && "posted this"}
                        {e.kind === "status" && `marked it ${e.body}`}
                        {e.kind === "remark" && <>wrote: <span style={{ color: "var(--fg)" }}>{e.body}</span></>}
                        {e.kind === "forwarded" && (
                          <>passed it to <strong>{nameOf.get(e.to_user_id ?? "") ?? "someone"}</strong>{e.body ? ` — ${e.body}` : ""}</>
                        )}
                        {" · "}{when(e.created_at)}
                      </li>
                    ))}
                  </ul>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  {t.status !== "doing" && t.status !== "done" && (
                    <form action={setTaskStatus}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="status" value="doing" />
                      <SubmitButton className="btn small secondary" savedLabel="Started">▶ Start</SubmitButton>
                    </form>
                  )}
                  {t.status !== "done" && (
                    <form action={setTaskStatus}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="status" value="done" />
                      <SubmitButton className="btn small" savedLabel="Done">✅ Mark done</SubmitButton>
                    </form>
                  )}
                  {t.status === "done" && (
                    <form action={setTaskStatus}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="status" value="open" />
                      <SubmitButton className="btn small secondary" savedLabel="Reopened">↩︎ Reopen</SubmitButton>
                    </form>
                  )}
                </div>

                <form action={addRemark} style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <input type="hidden" name="id" value={t.id} />
                  <input name="body" placeholder="Add a remark…" style={{ flex: 1, minWidth: 200, marginBottom: 0 }} />
                  <SubmitButton className="btn small secondary" savedLabel="Added">💬 Remark</SubmitButton>
                </form>

                <form action={forwardTask} style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input type="hidden" name="id" value={t.id} />
                  <select name="to_user_id" required style={{ minWidth: 170, marginBottom: 0 }}>
                    <option value="">Pass it to…</option>
                    {staff.filter((s) => s.id !== t.assignee_id).map((s) => (
                      <option key={s.id} value={s.id}>{s.full_name || s.email}</option>
                    ))}
                  </select>
                  <input name="why" placeholder="Why (optional)" style={{ flex: 1, minWidth: 160, marginBottom: 0 }} />
                  <SubmitButton className="btn small secondary" savedLabel="Passed">➡️ Forward</SubmitButton>
                </form>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
