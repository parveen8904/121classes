// Minimal service worker — makes the app installable and caches only static
// assets for offline. It NEVER caches page HTML/navigations, so pages are always
// fetched fresh from the network (no stale landing page after a deploy). It also
// never touches API/auth or cross-origin (Supabase, Bunny, CDN) requests.
const CACHE = "ca-shell-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // skip Supabase / Bunny / CDN
  if (url.pathname.startsWith("/api/")) return; // never cache API/auth

  // Pages/HTML: don't intercept at all — always load fresh from the network so a
  // new deploy is never hidden behind a cached page.
  if (req.mode === "navigate" || req.destination === "document") return;

  // Static assets (JS/CSS/images/fonts): network-first, fall back to cache offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
