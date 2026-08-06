// Minimal service worker — makes the app installable, and makes the ONE page a
// student needs without internet work without internet.
//
// The apps (iOS/Android/desktop) are shells around the live site, and this
// worker used to skip page navigations entirely so a deploy could never be
// hidden behind a stale page. That was right for every page but one: a class
// downloaded for offline viewing sat encrypted on the device while
// /learn/downloads — the only page that can list and play it — could not load
// without a connection. "Download to watch offline" needed the internet.
//
// So navigations are still NETWORK-FIRST (online, you always get today's page),
// but a small allowlist is kept in the cache and served when the network fails.
// Anything else falls back to a plain offline card pointing at the downloads.
const CACHE = "ca-shell-v3";
const OFFLINE_URL = "/offline.html";

// Pages worth keeping a copy of. Deliberately short: these are the pages that
// are useful with no connection, not a mirror of the site.
const OFFLINE_PAGES = ["/learn/downloads"];
const keepOffline = (pathname) => OFFLINE_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).catch(() => {}));
  self.skipWaiting();
});

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

  // ── Pages ────────────────────────────────────────────────────────────────
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Keep a copy of the offline-useful pages, so the LAST version seen
          // while online is the one shown in aeroplane mode.
          if (res && res.ok && keepOffline(url.pathname)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req, { ignoreSearch: true });
          if (cached) return cached;
          // Not a page we kept — say so plainly and point at what does work.
          return (await caches.match(OFFLINE_URL)) ?? Response.error();
        }),
    );
    return;
  }

  // ── Static assets (JS/CSS/images/fonts) ──────────────────────────────────
  // Network-first, cache as we go, fall back to the cache offline. Without this
  // the cached page above would render with no JavaScript and do nothing.
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
