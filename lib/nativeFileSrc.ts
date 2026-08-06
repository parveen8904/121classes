// Turn a native file path into a URL the in-app WebView will actually serve.
//
// Capacitor's own convertFileSrc() builds this from window.WEBVIEW_SERVER_URL,
// and on ANDROID that variable is set to the whole server.url from
// capacitor.config — path included. Ours is
//
//     https://caparveensharma.com/dashboard
//
// so convertFileSrc returned
//
//     https://caparveensharma.com/dashboard/_capacitor_file_/data/.../play-x.mp4
//
// The WebView only recognises a device file when the path STARTS with
// /_capacitor_file_ (WebViewLocalServer.isLocalFile reads the path alone). With
// /dashboard in front of it the request missed that test entirely and was sent
// out to the website instead of to the phone: a 404 with internet, and nothing
// at all in aeroplane mode. Every downloaded class on Android failed to play,
// which is exactly what it looked like from the outside.
//
// iOS was never affected — there WEBVIEW_SERVER_URL is capacitor://localhost,
// scheme and host only.
//
// So: keep the origin Capacitor chose, and hand the file marker the root.
// Done with plain string work on purpose. new URL("capacitor://localhost/x")
// .origin is the STRING "null" — a custom scheme has no origin — so parsing it
// would have fixed Android by breaking iOS.
export function nativeFileSrc(path: string, convert?: (p: string) => string): string {
  const raw = convert ? convert(path) : path;
  const at = raw.indexOf("/_capacitor_file_");
  if (at <= 0) return raw;

  const head = raw.slice(0, at);            // https://caparveensharma.com/dashboard
  const sep = head.indexOf("://");
  if (sep < 0) return raw;
  const pathStart = head.indexOf("/", sep + 3);
  const root = pathStart < 0 ? head : head.slice(0, pathStart);
  return root + raw.slice(at);              // https://caparveensharma.com/_capacitor_file_/…
}
