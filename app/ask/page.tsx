import Link from "next/link";
import { tryServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { unstable_cache } from "next/cache";

// SERVED FROM THE EDGE, REFRESHED EVERY FIVE MINUTES.
//
// This used to be force-dynamic, for two reasons that no longer hold. The
// first — createServiceClient() has no key at build time — is answered by
// tryServiceClient() below, which is how /courses and /articles prerender.
// The second, that the numbers must be changeable without a deploy, is exactly
// what ISR gives: edit them in Admin and they appear within five minutes, no
// deploy involved.
//
// It mattered because this is the page the marketing points at. It reported
// x-vercel-cache: MISS on every request and cost two round trips to Mumbai to
// print three phone numbers that change perhaps twice a year.
export const revalidate = 300;

// The bot's @name, boxed so its clock is not the page's clock.
//
// getSecret renews every thirty seconds — right for an API key, wrong as the
// heartbeat of a page whose contents change twice a year. Next takes the
// SHORTEST cache life in a route, so reading it directly pulled this page's
// five minutes down to thirty seconds. Behind this box the route no longer
// sees that, and a name changed in Admin still lands at once: clearSecretCache
// purges the shared entry underneath.
const telegramBotName = unstable_cache(
  async () => (await getSecret("TELEGRAM_BOT_USERNAME")).trim().replace(/^@/, ""),
  ["ask-telegram-bot-name"],
  { revalidate: 300 },
);
export const metadata = {
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/ask" },
  title: "Ask a doubt",
  description:
    "Stuck on a sum at midnight? Ask on WhatsApp, Telegram or email and get a worked answer from CA Parveen Sharma's own material — usually in seconds.",
};

// One page the marketing can point at.
//
// The promise is "ask us any time". It is true on four channels now, but a
// student had to know which one, and the Telegram half was worse than useless:
// told to "message us on Telegram" they searched the name and landed in CA
// Parveen Sharma's private chat rather than the bot that answers.
//
// So: one page, one tap per channel, every link direct. Nothing here asks
// anybody to search for anything or to join a group first.
export default async function AskPage() {
  const svc = tryServiceClient();
  if (!svc) return null; // local build without env — Vercel always has it

  // Both reads at once. They were sequential, and neither needs the other's
  // answer: two round trips to Mumbai, one after the other, before a visitor
  // saw anything.
  const [{ data }, botRaw] = await Promise.all([
    svc.from("site_settings").select("key, value")
      .in("key", ["support_whatsapp", "support_telegram", "support_phone"]),
    telegramBotName(),
  ]);
  const m = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "")]));

  const waDigits = (m.get("support_whatsapp") ?? "").replace(/\D/g, "");
  const wa = waDigits ? (waDigits.length === 10 ? `91${waDigits}` : waDigits) : "";
  const phone = (m.get("support_phone") ?? "").replace(/\D/g, "");
  const bot = botRaw;

  const channels = [
    wa && {
      href: "/wa",
      icon: "💬",
      colour: "#25D366",
      title: "WhatsApp",
      line: "The fastest. Send the question as you would to a friend.",
      sub: `+${wa}`,
    },
    (bot || m.get("support_telegram")) && {
      href: "/tg",
      icon: "✈️",
      colour: "#229ED9",
      title: "Telegram",
      line: "Message the study bot directly — no group to join.",
      sub: bot ? `@${bot}` : "our doubt bot",
    },
    {
      href: "mailto:sir@caparveensharma.com",
      icon: "✉️",
      colour: "#0f766e",
      title: "Email",
      line: "Long question, or want the working written out? Write in.",
      sub: "sir@caparveensharma.com",
    },
    {
      href: "/check-my-paper",
      icon: "📝",
      colour: "#b45309",
      title: "Get a paper checked",
      line: "Written a paper by hand? Send it and get it back marked.",
      sub: "Free — no plan needed",
    },
    {
      href: "/dashboard",
      icon: "📘",
      colour: "#7c3aed",
      title: "Inside the portal",
      line: "Ask on the class you are watching — the answer knows the chapter.",
      sub: "Students only",
    },
  ].filter(Boolean) as { href: string; icon: string; colour: string; title: string; line: string; sub: string }[];

  return (
    <main>
      <section className="container" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 760 }}>
        <span className="badge">💡 Ask a doubt</span>
        <h1 style={{ margin: "12px 0 8px" }}>Stuck at midnight? Ask.</h1>
        <p className="muted" style={{ fontSize: "1.02rem", lineHeight: 1.7 }}>
          Send your question on whichever of these you already use. You get a worked answer from CA Parveen
          Sharma&apos;s own class material — usually in seconds, and a faculty member picks up anything the material
          cannot settle. No group to join, no form to fill.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
          {channels.map((c) => (
            <a
              key={c.title}
              href={c.href}
              className="card"
              style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none" }}
              target={c.href.startsWith("/") ? undefined : "_blank"}
              rel="noopener noreferrer"
            >
              <span
                aria-hidden
                style={{
                  width: 44, height: 44, borderRadius: 12, background: c.colour, color: "#fff",
                  display: "grid", placeItems: "center", fontSize: "1.3rem", flex: "0 0 auto",
                }}
              >
                {c.icon}
              </span>
              <span style={{ flex: 1 }}>
                <strong style={{ display: "block" }}>{c.title}</strong>
                <span className="muted" style={{ fontSize: ".9rem" }}>{c.line}</span>
                <span className="muted" style={{ fontSize: ".8rem", display: "block", marginTop: 2 }}>{c.sub}</span>
              </span>
              <span aria-hidden style={{ color: "var(--muted)" }}>→</span>
            </a>
          ))}
        </div>

        {phone && (
          <p className="muted" style={{ fontSize: ".9rem", marginTop: 20 }}>
            Prefer to talk? Call <a href={`tel:+91${phone}`}>+91 {phone}</a> — 10 am to 7 pm, Monday to Saturday.
            That line is for calls; please send study doubts on WhatsApp so they reach the material.
          </p>
        )}

        <p className="muted" style={{ fontSize: ".85rem", marginTop: 22 }}>
          Not a student yet? <Link href="/courses">See the courses</Link> or{" "}
          <Link href="/planner">build a free study plan</Link> first — you can still ask anything above.
        </p>
      </section>
    </main>
  );
}
