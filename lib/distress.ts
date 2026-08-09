import { getSecret } from "@/lib/secrets";

// WHEN A STUDENT IS NOT ALRIGHT.
//
// CA students carry years of pressure, and some of it arrives in our inbox. A
// message about failing an attempt is sometimes a message about far more than
// an attempt. Whatever else this system does, it must not answer "how do I
// value a current investment" to somebody who has just said they cannot go on.
//
// Two rules shape everything here:
//
//   1. NEVER MISS ONE. The cost of the two mistakes is nowhere near equal. An
//      unnecessary offer of help is a small awkwardness; a missed one is not
//      recoverable. So this runs FIRST, before the chatter test, before the
//      abuse test, before any study answer — and when the model cannot be
//      reached, a plain word match still catches the severe cases on its own.
//
//   2. DO NOT PLAY COUNSELLOR. We are a coaching institute. The right thing is
//      to say plainly that they matter, put real trained help in front of them,
//      and tell a person here — not to reassure, diagnose, or talk them round.
//
// Exam talk is not distress. "This paper killed me", "I'm dying", "mar gaya" —
// students say these all day and it would be absurd, and eventually ignored, to
// send a helpline every time. Anything short of an explicit statement about
// their own life is checked with the model before it counts.

/** Said to the student. Kept short, warm, and free of advice we are not qualified to give. */
export const DISTRESS_REPLY =
  "I am glad you wrote, and I want to answer this part first.\n\n" +
  "What you are carrying sounds genuinely heavy, and you should not have to carry it by yourself. " +
  "Exams matter, but nothing about an exam is worth more than you are.\n\n" +
  "Please speak to someone trained — today, if you can. These are free, confidential, and answer around the clock:\n\n" +
  "• Tele-MANAS (Government of India): 14416 or 1800-891-4416\n" +
  "• KIRAN Mental Health Helpline: 1800-599-0019\n" +
  "• Vandrevala Foundation: 9999 666 555\n" +
  "• AASRA: 9820 466 726\n\n" +
  "If you are in immediate danger, please call 112, or ask someone near you to sit with you now.\n\n" +
  "Please also tell one person at home or a friend you trust. You do not have to explain it well — just tell them.\n\n" +
  "We are still here for your studies whenever you want them, and there is no hurry at all.\n\n" +
  "— CA Parveen Sharma Classes";

// Explicit statements about their own life or safety. These do NOT wait for a
// model to agree: if the model is unreachable or slow, they still count.
const SEVERE =
  /\b(kill myself|killing myself|end my life|ending my life|take my life|taking my life|want to die|wanna die|don'?t want to live|do not want to live|no reason to live|better off dead|suicide|suicidal|self ?harm|hurt myself|hurting myself|cut myself|jaan de|jaan dene|khudkushi|aatmahatya|marna chahta|marna chahti|mar jaunga|mar jaungi|zindagi khatam|jeena nahi chahta|jeene ka mann nahi)\b/i;

// Weaker signals. Real distress often sounds like this — but so does a bad week
// before an attempt, so the model decides.
const SOFT =
  /\b(depress(ed|ion|ing)?|hopeless|worthless|useless|no point|giving up|give up on life|can'?t cope|cannot cope|can'?t take (it|this) any ?more|cannot take (it|this) any ?more|breaking down|broke down|panic attack|anxiety attack|crying|cry every|not eating|can'?t sleep|cannot sleep|alone|lonely|nobody cares|no one cares|failure|failed again|ashamed|burden|tired of everything|fed up of life|ghabra|tanav|pareshan|akela|himmat nahi)\b/i;

export type DistressCheck = { distressed: boolean; severe: boolean; why: string };

/**
 * Is this student in trouble beyond their studies?
 *
 * Deliberately generous. Where it is uncertain and the model cannot be reached,
 * it answers YES on the severe words and NO on the soft ones — the first
 * because silence there is unthinkable, the second because a helpline under
 * every "I failed again" would train everybody to ignore it.
 */
export async function checkDistress(text: string): Promise<DistressCheck> {
  const t = (text ?? "").trim();
  if (!t) return { distressed: false, severe: false, why: "empty" };

  const severe = SEVERE.test(t);
  const soft = SOFT.test(t);
  if (!severe && !soft) return { distressed: false, severe: false, why: "no signal" };

  // These words also live in the syllabus. "What is the suicide clause in a life
  // insurance policy?" is a textbook question, and sending helplines plus an
  // urgent alert every time somebody studies Ind AS 104 would teach everyone
  // here to stop reading the alerts — which is how a real one gets missed.
  //
  // So a match is CONFIRMED when there is a model to confirm it with. When
  // there is not, the two cases part company: a severe match still counts,
  // because silence there is unthinkable, and a soft one does not.
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return severe
      ? { distressed: true, severe: true, why: "explicit words, and no model available to check" }
      : { distressed: false, severe: false, why: "soft signal, no model to check with" };
  }

  try {
    const { judgeDistress } = await import("@/lib/ai");
    const yes = await judgeDistress(t);
    return {
      distressed: yes,
      severe: yes && severe,
      why: yes
        ? (severe ? "explicit, and confirmed" : "confirmed as real distress")
        : (severe ? "the words appear, but academically — not about themselves" : "reads as exam pressure, not distress"),
    };
  } catch {
    // The check failed rather than answered. Err the way that cannot be undone.
    return severe
      ? { distressed: true, severe: true, why: "explicit words, and the check failed" }
      : { distressed: false, severe: false, why: "could not check" };
  }
}

/**
 * Tell a person, and write it down.
 *
 * The alert goes out whatever else happens. A student in trouble is not a
 * ticket to be worked through a queue — somebody here should know within
 * minutes, and be able to pick up a phone.
 */
export async function raiseDistress(opts: {
  channel: string;
  question: string;
  who?: string | null;
  userId?: string | null;
  severe: boolean;
}): Promise<void> {
  const { channel, question, who, userId, severe } = opts;

  try {
    const { notifyFaculty } = await import("@/lib/notify");
    await notifyFaculty(
      severe
        ? "🚨 URGENT — a student may be in danger"
        : "⚠️ A student sounds like they are struggling",
      `Channel: ${channel}\nFrom: ${who ?? "unknown"}\n\nWhat they wrote:\n${question}\n\n` +
        `They have been sent the helpline numbers and asked to speak to someone.\n` +
        (severe
          ? `This one used explicit words about their own life. Please have somebody call them now.`
          : `Worth a call from a person if you can reach them.`),
    );
  } catch { /* the alert must never block the reply to the student */ }

  try {
    const { logAiExchange } = await import("@/lib/aiAnswerLog");
    await logAiExchange({
      channel,
      question,
      answer: DISTRESS_REPLY,
      userId: userId ?? null,
      // Left OPEN on purpose. The automatic reply is not the end of this; it
      // stays in the report until a person has actually spoken to them.
      status: "open",
    });
  } catch { /* best effort */ }
}
