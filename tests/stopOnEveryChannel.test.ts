// STOP has to work on Telegram and WhatsApp too, not only email.
import { readFileSync } from "node:fs";
import { isStopWord, isStartWord } from "../lib/stopWords.ts";
let fails = 0;
const check = (what: string, ok: boolean, why = "") => {
  if (!ok) { fails++; console.log(`FAIL  ${what}${why ? " — " + why : ""}`); }
};
const notify = readFileSync("lib/notify.ts", "utf8");
const tg = readFileSync("app/api/telegram/webhook/route.ts", "utf8");
const wa = readFileSync("app/api/whatsapp/webhook/route.ts", "utf8");

/* ── the words ───────────────────────────────────────────────────────────── */

check("plain stop words are honoured",
  ["STOP", "stop", "Unsubscribe", "/stop", "opt out", "remove me", "band karo", "Stop."].every(isStopWord));
check("a doubt that merely CONTAINS the word is not a stop",
  !isStopWord("stop confusing me on this AS 115 question") && !isStopWord("I cannot stop the video"),
  "silently unsubscribing a student mid-question is a bug they could never diagnose");
check("an empty or long message is not a stop", !isStopWord("") && !isStopWord("x".repeat(40)));
check("start means resume", isStartWord("START") && isStartWord("/start") && isStartWord("resume"));

/* ── one list, every channel ─────────────────────────────────────────────── */

check("the guard takes a channel", /isBlocked\(to: string, channel: Channel = "email"\)/.test(notify));
check("it filters on the channel too", /\.eq\("channel", channel\)\.eq\("email", addr\)/.test(notify),
  "one list is the point — a second one is the same mistake in a new shape");

check("Telegram is checked where a PERSON is messaged",
  /if \(await isBlocked\(String\(chatId\), "telegram"\)\) return false;/.test(notify));
check("WhatsApp is checked in waSend, which every message goes through",
  /if \(await isBlocked\(to, "whatsapp"\)\) \{/.test(notify),
  "text, template and image all pass through there");
check("a suppressed WhatsApp send is recorded, not silent",
  /recipient asked us to stop/.test(notify));
check("every chat message says how to stop", /const STOP_LINE = "Reply STOP/.test(notify));
check("the stop line is actually appended to Telegram messages",
  /\$\{STOP_LINE\}/.test(notify));

/* ── the webhooks act on it ──────────────────────────────────────────────── */

for (const [name, src] of [["Telegram", tg], ["WhatsApp", wa]] as const) {
  check(`${name} honours STOP`, /honourStop\(/.test(src));
  check(`${name} confirms BEFORE blocking`,
    src.indexOf("STOP_CONFIRMATION") < src.indexOf("honourStop("),
    "afterwards our own guard would refuse to send the confirmation");
  check(`${name} only resumes somebody who actually stopped`,
    /if \(await isBlocked\(/.test(src),
    "Telegram sends a bare /start whenever anyone opens the bot");
}
check("Telegram checks stop before it logs the person as an audience member",
  tg.indexOf("isStopWord(text)") < tg.indexOf('from("telegram_subscribers")'));
check("WhatsApp checks stop before the auto-reply actually fires",
  wa.indexOf("isStopWord(body)") < wa.indexOf("await autoReplyTo(from)"),
  "the module import sits above the loop; what matters is the call");

/* ── the daily review shows it ───────────────────────────────────────────── */

const review = readFileSync("app/api/cron/outbound-review/route.ts", "utf8");
check("the review counts stops per channel", /unsubscribed_by_channel/.test(review),
  "a climbing number is the earliest honest signal that something sends too much");

console.log(fails ? `${fails} failed` : "ok — STOP works on every channel");
process.exit(fails ? 1 : 0);
