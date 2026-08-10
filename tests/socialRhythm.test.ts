import { slotsForDay, slotsForWeek, weekStart, addDays, weekdayOf, RHYTHM_IN_WORDS } from "../lib/socialRhythm";

// THE RHYTHM THE FOUNDER ASKED FOR, CHECKED AGAINST WHAT HE SAID.
//
// Every line below is one of his sentences turned into a question the code has
// to answer. The value of this file is that the plan page and the words at the
// top of the plan page cannot drift apart from the schedule underneath them.

let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log(`FAIL  ${what}`); } };
const has = (iso: string, ch: string) => slotsForDay(iso).some((s) => s.channels.includes(ch as never));

// A known week: Monday 17 August 2026 → Sunday 23 August 2026.
const MON = "2026-08-17";
const days = Array.from({ length: 7 }, (_, i) => addDays(MON, i));
check(weekdayOf(MON) === 1, "17 August 2026 is a Monday (the week this test is built on)");

// ── "every day there should be a Twitter post" ────────────────────────────
for (const d of days) check(has(d, "x"), `X posts on ${d} — every day means every day`);

// ── "every Wednesday and Friday … LinkedIn, Medium and Substack" ──────────
for (const d of days) {
  const want = weekdayOf(d) === 3 || weekdayOf(d) === 5;
  for (const ch of ["linkedin", "medium", "substack"]) {
    check(has(d, ch) === want, `${ch} on ${d} → ${want ? "yes" : "no"}`);
  }
}
// The three go out together or not at all — it is one piece of thinking.
for (const d of days) {
  const s = slotsForDay(d).find((x) => x.kind === "longform");
  if (s) check(s.channels.length === 3, `${d}: the long-form slot carries all three, not one`);
}

// ── "on every alternate … Instagram post along with a Facebook post" ──────
for (const d of days) {
  check(has(d, "instagram") === has(d, "facebook"), `${d}: Instagram and Facebook always travel together`);
}
const igDays = days.filter((d) => has(d, "instagram"));
check(igDays.length === 3 || igDays.length === 4, `Instagram lands 3 or 4 times a week (got ${igDays.length})`);
for (let i = 1; i < igDays.length; i++) {
  const gap = (Date.parse(igDays[i]) - Date.parse(igDays[i - 1])) / 86400000;
  check(gap === 2, `${igDays[i - 1]} → ${igDays[i]} is exactly two days apart, never three`);
}
// And it must keep alternating ACROSS weeks, not restart each Monday.
const nextWeekIg = Array.from({ length: 7 }, (_, i) => addDays(MON, 7 + i)).filter((d) => has(d, "instagram"));
const acrossGap = (Date.parse(nextWeekIg[0]) - Date.parse(igDays[igDays.length - 1])) / 86400000;
check(acrossGap === 2, `the alternation carries over the week boundary (gap was ${acrossGap})`);

// ── "every Monday, Thursday and Saturday I should have YouTube videos" ────
for (const d of days) {
  const want = [1, 4, 6].includes(weekdayOf(d));
  check(has(d, "youtube") === want, `YouTube on ${d} → ${want ? "yes" : "no"}`);
}

// ── "every 15th day Saturday evening … Discord voice meeting" ────────────
const saturdays = Array.from({ length: 8 }, (_, i) => addDays("2026-08-01", i * 7));
const meetings = saturdays.filter((d) => has(d, "discord"));
check(saturdays.every((d) => weekdayOf(d) === 6), "the fortnight check is built on real Saturdays");
check(meetings.length === 4, `over eight Saturdays there are four meetings (got ${meetings.length})`);
for (let i = 1; i < meetings.length; i++) {
  const gap = (Date.parse(meetings[i]) - Date.parse(meetings[i - 1])) / 86400000;
  check(gap === 14, `${meetings[i - 1]} → ${meetings[i]} is a fortnight (got ${gap} days)`);
}
// It is a meeting, not a post. Nothing must ever be published to Discord by it.
for (const d of meetings) {
  const s = slotsForDay(d).find((x) => x.channels.includes("discord"));
  check(s?.kind === "meeting", `${d}: the Discord slot is a meeting, not something to publish`);
}
// And it is an evening.
for (const d of meetings) {
  const s = slotsForDay(d).find((x) => x.kind === "meeting")!;
  check(Number(s.time.slice(0, 2)) >= 18, `${d}: "Saturday evening" means after 6 pm (got ${s.time})`);
}

// ── The week hangs together ───────────────────────────────────────────────
const week = slotsForWeek("2026-08-19");   // asked mid-week, still returns the whole week
check(week[0].date === MON, "a week always starts on its Monday, whichever day you ask from");
check(new Set(week.map((s) => s.date)).size === 7, "all seven days appear");
check(weekStart("2026-08-23") === MON, "Sunday belongs to the week that began on Monday");
// Nothing may be scheduled twice at the same minute on the same day.
for (const d of days) {
  const times = slotsForDay(d).map((s) => s.time);
  check(new Set(times).size === times.length, `${d}: no two slots collide at the same time`);
}
// Times run forward through the day, so the plan reads top to bottom.
for (const d of days) {
  const times = slotsForDay(d).map((s) => s.time);
  check(times.join() === [...times].sort().join(), `${d}: slots come out in time order`);
}

// ── The words on the page match the code under it ────────────────────────
check(RHYTHM_IN_WORDS.length === 5, "five lines describe the rhythm");
const said = RHYTHM_IN_WORDS.map((r) => r.what.toLowerCase()).join(" ");
for (const name of ["x", "linkedin", "medium", "substack", "instagram", "facebook", "youtube", "discord"]) {
  check(said.includes(name), `the description mentions ${name} — a channel that posts unannounced is a surprise`);
}

console.log(fails === 0 ? "PASS  social rhythm: daily X, Wed+Fri long-form, alternate-day IG+FB, Mon/Thu/Sat video, fortnightly Saturday voice call" : "");
process.exit(fails === 0 ? 0 : 1);
