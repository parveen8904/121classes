import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import AdminHero from "../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import SubmitButton from "@/app/components/SubmitButton";
import { refreshIdeas, toggleCheck } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Growth desk — Admin" };

// ONE PLACE THAT TELLS HIM HOW TO GROW.
//
// Built 19 August, the day the founder reviewed his Instagram with the numbers
// open: a personality reel had done 1.6M views while designed posters sat at
// 5K on the same account. He said he will make the content himself — so this
// page HANDS HIM the plan and the ideas, and posts nothing, ever.
//
// Three parts: what his own numbers proved, the account changes still to make
// (tickable, so the office can see what is done), and fresh reel ideas drafted
// on demand — never auto-refreshed, because an idea nobody asked for is spam
// in your own admin.

// What the 19 Aug review of @ca_parveen_sharma (19.4K followers) found. Static
// on purpose: these are observations of record, not live figures.
const FINDINGS = [
  { n: "1.6M views", what: "POV/trend reel — him on camera, playful, with other faculty (Collab post)" },
  { n: "30.1K views", what: "Kailash Yatra — personal, real, his face" },
  { n: "12.9K views", what: "Exam-strategy talking head with a designed cover" },
  { n: "~5K views", what: "Everything else: posters, event photos, festival graphics" },
];

const CHECKLIST = [
  { id: "bio", label: "Rewrite the bio for students, not conferences", detail: "“FR (CA Final) & Adv. Accounting (Inter) · 36 years of teaching · Free study planner & chapter tests ↓” — the current “EdTech Pioneer / Transforming legacy education” speaks to organisers, not students." },
  { id: "pin", label: "Pin the 1.6M reel and the best strategy reel", detail: "Profile → the reel → ⋯ → Pin to profile. A first-time visitor should meet the strongest material first." },
  { id: "window", label: "Post between 7 and 9 pm", detail: "When students put the books down and pick the phone up. Schedule ahead if recording in the morning." },
  { id: "posters", label: "Stop posting posters and event photos to the feed", detail: "They averaged ~5K and teach the algorithm the account is boring. Put them in Stories instead — followers still see them, reach is not punished." },
  { id: "stories", label: "One Story a day", detail: "A poll, a doubt box, one class moment. Stories keep the existing followers warm — and warm followers are who new reels are shown to first." },
  { id: "collab", label: "Post trend reels as Collabs with the other faculty", detail: "A Collab lands in both accounts' audiences at once. The 1.6M reel was exactly this format." },
  { id: "cadence", label: "Hold a 5-posts-a-week rhythm", detail: "2 concept explainers, 1 exam-strategy talk, 1 personality/trend reel, 1 comment-trigger lead magnet. 51 posts total on a 19.4K account is an under-fed machine." },
  { id: "handle", label: "Decide the two-account question", detail: "The API posts to @caparveensharmaclasses (2.3K) while the audience sits on @ca_parveen_sharma (19.4K). Either connect the big account to the API too, or make the personal account the only stage and let the classes account repost." },
];

type Idea = { hook: string; format: string; outline: string };

const FMT_ICON: Record<string, string> = {
  concept: "📖", strategy: "🎯", personality: "😄", "lead-magnet": "🧲",
};

export default async function GrowthPage(props: { searchParams: Promise<{ err?: string }> }) {
  await assertArea(null);
  const sp = await props.searchParams;
  const svc = createServiceClient();

  const { data: rows } = await svc
    .from("site_settings").select("key, value").in("key", ["growth_ideas", "growth_checklist"]);
  const map = new Map((rows ?? []).map((r) => [String(r.key), String(r.value ?? "")]));

  let ideas: Idea[] = [];
  let ideasAt: string | null = null;
  try {
    const j = JSON.parse(map.get("growth_ideas") || "{}");
    if (Array.isArray(j.ideas)) { ideas = j.ideas; ideasAt = j.at ?? null; }
  } catch { /* none drafted yet */ }

  let done: Record<string, string> = {};
  try { done = JSON.parse(map.get("growth_checklist") || "{}"); } catch { /* none ticked */ }

  // Live snapshot of the API-connected account. The 19.4K personal account has
  // no API access, so its figures here would be guesses — and we don't guess.
  let live: { username: string; followers: number; media: number } | null = null;
  try {
    const [uid, token] = await Promise.all([getSecret("INSTAGRAM_USER_ID"), getSecret("INSTAGRAM_ACCESS_TOKEN")]);
    if (uid && token) {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${uid}?fields=username,followers_count,media_count&access_token=${token}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const j = (await res.json()) as { username?: string; followers_count?: number; media_count?: number };
        if (j.username) live = { username: j.username, followers: j.followers_count ?? 0, media: j.media_count ?? 0 };
      }
    }
  } catch { /* the panel shows nothing rather than a guess */ }

  const doneCount = CHECKLIST.filter((c) => done[c.id]).length;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📈 Growth desk"
        title="How to grow, and what to post"
        subtitle="What your own numbers proved, the account changes still pending, and fresh reel ideas on demand. Nothing here posts anything — you make the content. 🎬"
        back={{ href: "/admin", label: "Admin" }}
      />

      {sp.err && <div className="notice err" style={{ marginTop: 16 }}>The idea draft failed — try again in a minute.</div>}

      {live && (
        <div className="card" style={{ marginTop: 16, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline" }}>
          <div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>@{live.username}</div>
            <div className="muted" style={{ fontSize: ".8rem" }}>the account the API posts to</div>
          </div>
          <div><strong style={{ fontSize: "1.2rem" }}>{live.followers.toLocaleString("en-IN")}</strong> <span className="muted" style={{ fontSize: ".82rem" }}>followers</span></div>
          <div><strong style={{ fontSize: "1.2rem" }}>{live.media.toLocaleString("en-IN")}</strong> <span className="muted" style={{ fontSize: ".82rem" }}>posts</span></div>
          <div className="muted" style={{ fontSize: ".78rem", flexBasis: "100%" }}>
            Your main audience sits on <strong>@ca_parveen_sharma</strong> (19.4K at the 19 Aug review), which is not
            API-connected — see the last item on the checklist.
          </div>
        </div>
      )}

      {/* ── What the numbers proved ─────────────────────────────────────── */}
      <h2 className="admin-section-title">📊 What your own account proved (19 Aug review)</h2>
      <div style={{ display: "grid", gap: 6 }}>
        {FINDINGS.map((f) => (
          <div className="list-row" key={f.n}>
            <span className="row-title" style={{ minWidth: 110 }}>{f.n}</span>
            <span style={{ textAlign: "right" }}>{f.what}</span>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: ".84rem", marginTop: 8 }}>
        The lesson in one line: <strong>your face beats your posters by 300×.</strong> Students follow the teacher, not
        the notice board.
      </p>

      {/* ── The changes still to make ───────────────────────────────────── */}
      <h2 className="admin-section-title">✅ Account changes ({doneCount}/{CHECKLIST.length} done)</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {CHECKLIST.map((c) => (
          <div className="card" key={c.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", opacity: done[c.id] ? 0.55 : 1 }}>
            <form action={toggleCheck}>
              <input type="hidden" name="id" value={c.id} />
              <button type="submit" className="btn small secondary" style={{ minWidth: 44, marginBottom: 0 }} title={done[c.id] ? "Mark as not done" : "Mark as done"}>
                {done[c.id] ? "✅" : "⬜"}
              </button>
            </form>
            <div>
              <strong style={{ textDecoration: done[c.id] ? "line-through" : "none" }}>{c.label}</strong>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: ".84rem" }}>{c.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Content ideas ───────────────────────────────────────────────── */}
      <h2 className="admin-section-title">💡 Reel ideas</h2>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <form action={refreshIdeas}>
          <SubmitButton className="btn" savedLabel="✓ Drafted">Draft 10 fresh ideas</SubmitButton>
        </form>
        {ideasAt && (
          <span className="muted" style={{ fontSize: ".8rem" }}>
            last drafted {new Date(ideasAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })} IST
          </span>
        )}
      </div>
      {ideas.length === 0 ? (
        <div className="card" style={{ marginTop: 10 }}>
          <p className="muted" style={{ margin: 0 }}>
            Nothing drafted yet — press the button and ten ideas appear here: concept explainers, exam-strategy talks,
            personality formats and a comment-trigger lead magnet, each with its opening line written out.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {ideas.map((i, n) => (
            <div className="card" key={n}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span title={i.format}>{FMT_ICON[i.format] ?? "🎬"}</span>
                <strong>&ldquo;{i.hook}&rdquo;</strong>
                <span className="muted" style={{ fontSize: ".76rem" }}>{i.format}</span>
              </div>
              <p className="muted" style={{ margin: "6px 0 0", fontSize: ".86rem" }}>{i.outline}</p>
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: ".8rem", marginTop: 12 }}>
        Ideas follow the standing rules: only Financial Reporting and Advanced Accounting, no invented results, no
        sales voice. Record in one take, post between 7 and 9 pm, and put the hook as on-screen text in the first
        second.
      </p>
    </section>
  );
}
