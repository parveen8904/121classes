// Classify a request as coming from a phone or a computer. The desktop app
// (Electron) and any computer browser count as "desktop"; phones/tablets as
// "mobile". Used to allow exactly one active session per kind.
export function deviceKind(ua: string): "mobile" | "desktop" {
  return /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua) ? "mobile" : "desktop";
}
