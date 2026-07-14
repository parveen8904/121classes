// Always-on Discord worker for the two-way group discussion.
// Discord won't push channel messages over HTTP, so this small bot holds a live
// Gateway connection, and for each message in a mapped channel:
//   1) moderates it (same rules as the website),
//   2) deletes + logs it if flagged (bot needs "Manage Messages"),
//   3) stores it in Supabase group_messages (source = 'discord'),
//   4) relays clean messages to the subject's Telegram group.
// Deploy on any always-on host (Railway / Render / Fly / a small VPS).
//
// Required env:
//   DISCORD_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { createClient } from "@supabase/supabase-js";

const { DISCORD_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, SITE_URL, CRON_SECRET } = process.env;
if (!DISCORD_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env: DISCORD_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---- moderation (kept in sync with lib/moderation.ts) ----
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL = /(https?:\/\/|www\.)\S+|\b(?:t\.me|wa\.me|chat\.whatsapp\.com|bit\.ly|tinyurl\.com|youtu\.be|forms\.gle|linktr\.ee|rb\.gy)\/\S+/i;
const PHONE = /(?:\+?\d[\s-]?){10,}/;
const PROMO = /\b(buy now|earn money|work from home|click here|guaranteed|limited offer|cashback|forex|crypto|bitcoin|investment plan|join my|dm me|subscribe to my channel|promo ?code|coupon code|discount code|whatsapp me|telegram me)\b/i;
const ABUSE = ["fuck","fucking","bitch","bastard","asshole","dick","slut","whore","motherfucker","bullshit","cunt","retard","idiot","stupid","chutiya","chutiye","madarchod","behenchod","bhenchod","bsdk","mc","bc","gandu","lund","randi","harami","kamina","kutta","saala","saale","gaand","jhant","bhosdike","bhosdi","lauda","laude","tatti","chodu","raand"];
const ADULT = ["porn","porno","pornhub","xvideos","xnxx","onlyfans","nude","nudes","naked","sexy","sexting","boobs","hentai","xxx","blowjob","horny","erotic","stripper","escort","callgirl","call girl","nangi","chudai","chudayi","sambhog"];
// Admin-defined blocked terms (competitor names etc.) — site_settings key
// moderation_blocked_terms, one per line; refreshed with the channel map.
let blockedTerms = [];
function moderate(text) {
  const t = (text || "").trim();
  const reasons = [];
  if (!t) return { flagged: false, reasons };
  if (EMAIL.test(t)) reasons.push("email address");
  if (URL.test(t)) reasons.push("external link");
  if (PHONE.test(t)) reasons.push("phone number");
  if (PROMO.test(t)) reasons.push("advertisement / spam");
  const low = ` ${t.toLowerCase().replace(/[^a-z\s]/g, " ")} `;
  if (ABUSE.some((w) => low.includes(` ${w} `))) reasons.push("abusive language");
  if (ADULT.some((w) => low.includes(` ${w} `))) reasons.push("adult content");
  if (/(.)\1{9,}/.test(t)) reasons.push("spam (repetition)");
  const lowRaw = t.toLowerCase();
  const hit = blockedTerms.find((term) => term && lowRaw.includes(term.toLowerCase()));
  if (hit) reasons.push(`blocked term ("${hit}")`);
  return { flagged: reasons.length > 0, reasons };
}

async function tgRelay(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch (e) { console.error("tg relay failed", e?.message); }
}

// channel id -> { subjectId, telegram_group_chat_id } (refreshed periodically)
let channelMap = new Map();
async function refreshMap() {
  const { data } = await db.from("subjects").select("id, discord_channel_id, telegram_group_chat_id").not("discord_channel_id", "is", null);
  channelMap = new Map((data ?? []).map((s) => [s.discord_channel_id, { subjectId: s.id, tg: s.telegram_group_chat_id }]));
  const { data: bt } = await db.from("site_settings").select("value").eq("key", "moderation_blocked_terms").maybeSingle();
  blockedTerms = String(bt?.value ?? "").split("\n").map((l) => l.trim()).filter((l) => l.length >= 2);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

client.once("ready", async () => {
  await refreshMap();
  setInterval(refreshMap, 60_000);
  console.log(`Discord worker ready as ${client.user.tag}; watching ${channelMap.size} channel(s).`);
});

client.on("messageCreate", async (msg) => {
  try {
    if (msg.author?.bot) return; // ignore the bot's own + other bots/webhooks (prevents loops)
    const map = channelMap.get(msg.channelId);
    if (!map) return; // not a mapped subject channel
    const text = (msg.content || "").trim();
    if (!text) return;

    const name = msg.member?.displayName || msg.author?.username || "Member";
    const mod = moderate(text);
    let status = "visible";
    if (mod.flagged) {
      try { await msg.delete(); } catch {}
      status = "hidden";
    }
    const { data: gm } = await db
      .from("group_messages")
      .upsert(
        {
          chat_id: msg.channelId,
          subject_id: map.subjectId,
          tg_message_id: msg.id, // discord snowflake stored here for later deletion
          source: "discord",
          sender_tg_id: msg.author?.id ?? null,
          sender_name: name,
          body: text,
          flagged: mod.flagged,
          flag_reasons: mod.reasons,
          status,
        },
        { onConflict: "chat_id,tg_message_id" },
      )
      .select("id")
      .maybeSingle();
    if (mod.flagged && gm?.id) {
      await db.from("message_moderation_log").insert({ message_id: gm.id, action: "auto_hidden", reason: mod.reasons.join(", ") });
      return;
    }
    // Relay clean messages to the subject's Telegram group (bot-authored → no loop).
    if (map.tg) await tgRelay(map.tg, `👤 ${name}: ${text}`);
    // AI answer ONLY when the bot is @mentioned (or the message replies to the
    // bot) — it never interrupts a student-to-student discussion. Same
    // brain/toggle/cap as the Telegram groups via the site endpoint.
    const mentionsBot = msg.mentions?.users?.has(client.user.id)
      || (msg.reference && (await msg.fetchReference().catch(() => null))?.author?.id === client.user.id);
    if (mentionsBot && SITE_URL && CRON_SECRET) {
      try {
        const res = await fetch(`${SITE_URL}/api/group-ai-answer`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${CRON_SECRET}` },
          body: JSON.stringify({ discordChannelId: msg.channelId, question: text.replace(/<@!?\d+>/g, " ").replace(/\s+/g, " ").trim() }),
        });
        const j = await res.json().catch(() => null);
        if (j?.answer) await msg.reply({ content: j.answer.slice(0, 1990), allowedMentions: { repliedUser: false } });
      } catch (e) { console.error("ai answer failed", e?.message); }
    }
  } catch (e) {
    console.error("messageCreate error", e?.message);
  }
});

client.login(DISCORD_BOT_TOKEN);
