import { toppersMessage, toppersPushBody, toppersPushTitle, type Track } from "@/lib/dailyToppers";

// SENDING THE DAY'S TOPPERS — ONE COPY OF IT.
//
// This went out to four places, and the four calls were written twice: once in
// the 3 AM cron and once behind the "Send it now" button. That is how the
// phones ended up saying something different from Telegram — the notification
// title was built separately at each site and quietly drifted apart, exactly
// as the CA Inter / CA Final labels had drifted out of the body before that.
// One function now, used by both.
//
// WHAT GOES OUT: names, and nothing else. No marks, no percentage, no paper,
// no phone number, no email. This lands in group chats where every student can
// read it, and a topper is being congratulated, not ranked in public.

export type Channel = "channel" | "groups" | "discord" | "push";

export type AnnounceResult = {
  channel: boolean;
  groups: number;
  discord: boolean;
  push: { sent: number; failed: number } | null;
};

/**
 * Send one day's toppers.
 *
 * `only` limits it to a single channel. That exists because the four do not
 * always need re-sending together: on 26 Aug 2026 the notification wording
 * changed (his name, and a word for the students) while the Telegram and
 * Discord message stayed exactly the same, so re-announcing everything would
 * have dropped a second identical congratulation into the channel and every
 * subject group. The reverse happens too — a group that was down when the
 * others went out needs its copy without notifying every phone again.
 */
export async function announceToppers(
  day: string,
  rows: { track: Track; student_name: string }[],
  only?: Channel | null,
): Promise<AnnounceResult> {
  const text = toppersMessage(rows, day);
  const link = "https://caparveensharma.com/learn/performance";
  const wants = (what: Channel) => !only || only === what;

  // ONE MESSAGE, EVERYWHERE — not one per subject.
  //
  // His instruction: the channel AND both groups, "irrespective of inter
  // Final". A Final topper is news in the Intermediate room too; splitting the
  // announcement by subject would have shown each group only half of it.
  const [channel, groups, discord, push] = await Promise.all([
    wants("channel")
      ? import("@/lib/notify").then((m) => m.sendTelegramChannel(text, link)).catch(() => false)
      : Promise.resolve(false),
    wants("groups")
      ? import("@/lib/telegramBroadcast").then((m) => m.postToAllGroups(text, link)).catch(() => 0)
      : Promise.resolve(0),
    wants("discord")
      ? import("@/lib/discord").then((m) => m.postToDiscord(text, link)).catch(() => false)
      : Promise.resolve(false),
    wants("push")
      ? import("@/lib/push").then((m) => m.pushToEveryone({
          title: toppersPushTitle(day),
          body: toppersPushBody(rows),
          link: "/learn/performance",
        })).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    channel: channel as boolean,
    groups: groups as number,
    discord: discord as boolean,
    push: push ? { sent: push.sent, failed: push.failed } : null,
  };
}
