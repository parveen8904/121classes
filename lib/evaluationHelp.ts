// "My paper has not been checked."
//
// It is the complaint that does the most damage in a group, because it is
// public, it is about money already paid, and every other student reads it. On
// the old portal a copy could sit for weeks; on this one the AI marks it within
// minutes and the faculty release it, usually inside a couple of hours.
//
// So the bot answers it the moment it appears, with the route that actually
// works — rather than leaving it to be read by forty students and answered by
// nobody until the morning.
//
// The test is deliberately NARROW. This is the one thing the bot says without
// being asked, so a false positive interrupts a conversation it was not part
// of. It must see BOTH a paper word and a not-checked word in the same message.

const PAPER = /\b(test|paper|copy|copies|answer\s*sheet|answer\s*book|descriptive|exam|submission|submitted)\b/i;

const NOT_CHECKED =
  /\b(not\s*(yet\s*)?(check|checked|checking|evaluat\w*|mark\w*|assess\w*|correct\w*)|un\s*checked|unchecked|no\s*(result|marks|reply|response|feedback)|still\s*(waiting|pending)|pending\s*(since|from|for)?|kab\s*tak|kb\s*tk|nahi\s*(hua|aaya|mila)|koi\s*reply|result\s*nahi)\b/i;

// A question about how to GET it checked is the same need, and should get the
// same answer rather than a general reply.
const HOW_TO = /\b(how|kaise|kese|where|kahan)\b.{0,40}\b(check|checked|evaluat\w*|submit|upload)\w*/i;

export function isEvaluationComplaint(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 10) return false;
  if (!PAPER.test(t)) return false;
  return NOT_CHECKED.test(t) || HOW_TO.test(t);
}

/**
 * What the bot says. Two routes, in the order of how well they work:
 * the portal, where the paper is marked against CA Parveen Sharma's own
 * approved answer key and the faculty release it; and email, for a paper that
 * is not one of the portal's tests.
 */
export const EVALUATION_HELP =
  "Your copy does not have to wait. 🙂\n\n" +
  "1) The fastest way — take the test on the website: caparveensharma.com. Upload your answer book as ONE PDF and it is checked against Sir's own approved answer key, with the marks written on your own pages. Faculty release it, and papers are generally back within about two hours.\n\n" +
  "2) Already written it on paper, or it is an older test? Email the scan to sir@caparveensharma.com from the email address on your account, saying which test it is. It goes into the same checking queue.\n\n" +
  "Scan it as a single PDF — your phone does this: iPhone Notes → Scan Documents, or Google Drive → + → Scan. Photographs cannot be marked.\n\n" +
  "If a copy you have already uploaded is more than a day old, reply here with your registered email and it will be looked into personally.";
