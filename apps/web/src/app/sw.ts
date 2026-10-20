/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { Serwist, StaleWhileRevalidate, CacheFirst, ExpirationPlugin } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & SerwistGlobalConfig & { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };

// FLUX-1547: overrides for defaultCache's document/RSC/other matchers
// (@serwist/next/src/index.worker.ts) — same matcher predicates and
// cacheNames, but StaleWhileRevalidate with 30-day retention instead of
// NetworkFirst/24h, so repeat opens render from cache instantly and refresh
// in the background.
//
// Applied by swapping the `handler` in place on the matching defaultCache
// entries (matched by cacheName) rather than prepending a new catch-all ahead
// of defaultCache: defaultCache's "others" entry is itself a same-origin
// catch-all, and Serwist is first-matcher-wins, so hoisting a duplicate
// catch-all ahead of the array would shadow every dedicated static-asset
// handler (next-static-js-assets, static-image-assets, next-image, etc.)
// that also lives later in defaultCache.
const NAVIGATION_CACHE_OVERRIDES: Record<string, RuntimeCaching["handler"]> = {
  "pages-rsc-prefetch": new StaleWhileRevalidate({
    cacheName: "pages-rsc-prefetch",
    plugins: [
      new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
  "pages-rsc": new StaleWhileRevalidate({
    cacheName: "pages-rsc",
    plugins: [
      new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
  pages: new StaleWhileRevalidate({
    cacheName: "pages",
    plugins: [
      new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
  others: new StaleWhileRevalidate({
    cacheName: "others",
    plugins: [
      new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
};

const navigationOverriddenDefaultCache: RuntimeCaching[] = defaultCache.map((entry) => {
  const cacheName = (entry.handler as { cacheName?: string }).cacheName;
  const override = cacheName ? NAVIGATION_CACHE_OVERRIDES[cacheName] : undefined;
  return override ? { ...entry, handler: override } : entry;
});

const supabaseRuntimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ url }) => url.pathname.startsWith("/rest/v1/"),
    handler: new StaleWhileRevalidate({
      cacheName: "supabase-api-cache",
      plugins: [
        new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }),
      ],
    }),
  },
  {
    matcher: ({ url }) => url.pathname.startsWith("/storage/v1/object/"),
    handler: new CacheFirst({
      cacheName: "supabase-storage-cache",
      plugins: [
        new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }),
      ],
    }),
  },
];

// FLUX-150 slice 8: the BackgroundSyncPlugin POST/PATCH mutation queue is
// retired — every write path that used to rely on it now goes through a
// Legend-State store (src/lib/legend/*-store.ts), which persists + retries
// pending writes itself (see create-group-store.ts), making this SW-level
// interception redundant. Read caching (below) and push are unaffected.

const shareTargetRouting: RuntimeCaching = {
  method: "POST",
  matcher: ({ url }) => url.pathname === "/share-target",
  handler: {
    handle: async ({ request }) => {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const sharedUrl = formData.get("url") as string | null;
      const sharedText = formData.get("text") as string | null;

      if (file) {
        const cache = await caches.open("share-target-files");
        await cache.put("/share-target-file", new Response(file, {
          headers: { "Content-Type": file.type, "X-File-Name": file.name },
        }));
        return Response.redirect("/share-target", 303);
      }

      const urlValue = sharedUrl || sharedText || "";
      const urlMatch = urlValue.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        return Response.redirect(`/apartment/new?listing_url=${encodeURIComponent(urlMatch[0])}`, 303);
      }

      return Response.redirect("/share-target?error=no-file", 303);
    },
  },
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [shareTargetRouting, ...navigationOverriddenDefaultCache, ...supabaseRuntimeCaching],
  // FLUX-1546: precached app-shell for offline document navigations. Serwist
  // injects a PrecacheFallbackPlugin into every Strategy-based runtimeCaching
  // entry's `handlerDidError` — the document-only matcher means it only ever
  // substitutes the response for a failed navigation (RSC/data fetches have
  // `destination: "empty"` and are never caught here). This supersedes
  // HOUP-7's inline static placeholder: `/~offline` renders the real app shell
  // against already-cached local data instead of a dead "You're offline" page.
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

// HOUP-7: `defaultCache`'s document (navigation) strategy used to reject with
// `no-response` uncaught when there was no network and no cache hit. That path
// is now owned by `fallbacks` above (matched before this ever runs, for any
// document request). This remains only as the last-resort catch for requests
// `fallbacks` doesn't cover (non-document destinations, or failures outside
// any registered strategy) — no static HTML to serve for those, just fail.
serwist.setCatchHandler(async () => Response.error());

// FLUX-128: Web Push for task notifications.
// Payload shape sent by the Edge Functions: { title, body, url, tag }.
interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener("push", (event: PushEvent) => {
  let payload: PushPayload = {};
  if (event.data) {
    try {
      payload = event.data.json() as PushPayload;
    } catch {
      // Non-JSON / empty payloads: fall back to plain text as the body.
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || "Rooftap";
  const url = payload.url || "/tasks";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      // tag dedupes one logical notification across a user's devices and replaces
      // a prior notification with the same tag rather than stacking duplicates.
      tag: payload.tag,
      data: { url },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl = (event.notification.data as { url?: string } | undefined)?.url || "/tasks";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus an existing window if one is already open, navigating it to the
      // target so the deep-link (?focus=<taskId>) is honoured.
      for (const client of allClients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // navigate can reject cross-origin; ignore and keep the focused tab.
            }
          }
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});

// HOUP-62: Purge stale runtime document caches on activation. The NAVIGATION_CACHE_OVERRIDES
// use StaleWhileRevalidate with 30-day retention (from FLUX-1546/1547), which means a page cached
// before a deploy will be served indefinitely by a service worker (which intercepts navigations
// before a network request), referencing JS/CSS chunks that are now 404s in the new deployment.
// skipWaiting/clientsClaim ensure the new SW version activates promptly on each deploy; this
// activate listener then purges the stale document caches so StaleWhileRevalidate repopulates them
// fresh from the network on the next navigation, while content-hashed static chunks stay cached.
// Already-open tabs see one reload's worth of staleness (standard PWA behavior), but repeat visits
// and new tabs render the fresh deployment immediately afterward.
self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cacheNames = Object.keys(NAVIGATION_CACHE_OVERRIDES);
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    })()
  );
});

serwist.addEventListeners();
