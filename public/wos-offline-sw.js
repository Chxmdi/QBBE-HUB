/*
 * Workspace OS offline service worker (V3-1, behind the wos_offline switch).
 *
 * - Pages people open in the workspace areas below are kept, one cache per
 *   person, so the most recently used ones can be read offline. Online, the
 *   network always answers first; the cache is only a fallback.
 * - Built assets (/_next/static) are kept so a cached page still renders.
 * - Signing out, or a different person signing in, clears the page cache, so
 *   a shared device never shows one person's pages to another.
 * - When the switch is off (/api/offline/status), it clears everything and
 *   unregisters itself.
 * Structured changes made offline are queued by the page in IndexedDB, not
 * here; this worker never replays requests.
 */
const VERSION = "v1";
const STATIC_CACHE = `wos-static-${VERSION}`;
const META_CACHE = "wos-meta";
const PAGE_PREFIXES = ["/offline", "/my-work", "/projects", "/programs", "/board"];
const MAX_PAGES = 40;
const STATUS_CHECK_MS = 10 * 60 * 1000;
let lastStatusCheck = 0;

const pageCacheName = (userId) => `wos-pages-${VERSION}-${userId}`;

async function currentUser() {
  const meta = await caches.open(META_CACHE);
  const hit = await meta.match("/__wos_user");
  return hit ? hit.text() : null;
}

async function setUser(userId) {
  const meta = await caches.open(META_CACHE);
  await meta.put("/__wos_user", new Response(userId));
  const keep = pageCacheName(userId);
  for (const name of await caches.keys()) {
    if (name.startsWith("wos-pages-") && name !== keep) await caches.delete(name);
  }
}

async function clearAll() {
  for (const name of await caches.keys()) {
    if (name.startsWith("wos-")) await caches.delete(name);
  }
}

async function checkStillEnabled() {
  if (Date.now() - lastStatusCheck < STATUS_CHECK_MS) return;
  lastStatusCheck = Date.now();
  try {
    const res = await fetch("/api/offline/status", { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return;
    const body = await res.json();
    if (body && body.enabled === false) {
      await clearAll();
      await self.registration.unregister();
    }
  } catch {
    // Offline: nothing to learn.
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(key);
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  // Only this app's own pages may tell the worker who is signed in or to
  // clear the cache.
  if (event.origin !== self.location.origin) return;
  const data = event.data || {};
  if (data.type === "user" && typeof data.userId === "string" && /^[0-9a-f-]{36}$/i.test(data.userId)) {
    event.waitUntil(setUser(data.userId));
  } else if (data.type === "clear") {
    event.waitUntil(clearAll());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === "POST" && url.pathname === "/auth/sign-out") {
    event.waitUntil(clearAll());
    return;
  }
  if (request.method !== "GET") return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  if (request.mode !== "navigate") return;
  if (url.pathname === "/sign-in") {
    event.waitUntil(clearAll());
    return;
  }
  if (!PAGE_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return;

  event.respondWith(
    (async () => {
      const userId = await currentUser();
      try {
        const res = await fetch(request);
        event.waitUntil(checkStillEnabled());
        if (userId && res.ok && !res.redirected && res.type === "basic") {
          const cache = await caches.open(pageCacheName(userId));
          await cache.put(request, res.clone());
          await trim(cache);
        }
        return res;
      } catch (error) {
        if (userId) {
          const cache = await caches.open(pageCacheName(userId));
          const hit = (await cache.match(request)) || (await cache.match("/offline"));
          if (hit) return hit;
        }
        throw error;
      }
    })(),
  );
});
