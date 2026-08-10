// WHERE IT IS SAFE TO SEND SOMEBODY AFTER THEY SIGN IN OR SAVE.
//
// A "come back here afterwards" parameter travels in the address bar, which
// means anybody can write one. Honour a full URL and it becomes an open
// redirect: a link that looks like ours, carries the student through OUR
// sign-in or OUR save, and lands them on somebody else's page — which is
// exactly how people are taught to trust a page that then asks for a password.
//
// So only our own paths are ever honoured. Anything else is dropped and the
// caller falls back to its own default, which is never worse than a student
// ending up on their dashboard.

/** Control characters, and the backslash some parsers read as a slash. */
const UNSAFE = new RegExp("[\\u0000-\\u001f\\u007f\\\\]");

export function safeInternalPath(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/")) return "";   // no scheme, no host, no bare word
  if (s.startsWith("//")) return "";   // //evil.com is a URL, not a path
  // A control character hides the rest of the line from anyone reading the link
  // before they click it; a backslash makes /\evil.com a URL in some browsers.
  if (UNSAFE.test(s)) return "";
  if (s.includes(" ")) return "";
  return s;
}
