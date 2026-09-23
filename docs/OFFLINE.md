# Offline capture

A field officer in the paddy has no signal. Field Watch now records anyway.

## What works with no signal

The app opens (a service worker caches it), and these can be recorded:

- deliveries
- QC tests
- batch weigh points
- field events

Each is a NEW fact, so it can be written on the phone and sent later without
anyone having to resolve a conflict.

## What deliberately does not

**Settlement and payment.** Paying a farmer depends on which loads are already
settled and whether the moisture test exists. A phone holding yesterday's
picture could pay the same load twice, so settling requires a live connection.
`canQueue()` in `src/lib/offline-core.ts` is the list; adding a table there is
a decision about money, not a config change.

Satellite scans also need the network, but those run server-side anyway.

## How a record gets home

1. Saved to an outbox in IndexedDB, with an id generated on the device.
2. The officer sees "saved on this phone — will send when there is signal",
   and the header shows how many records are waiting.
3. On reconnect (and on a 60-second heartbeat while online) the queue drains
   oldest-first, one at a time.
4. A duplicate-key error means the row already landed on an earlier attempt, so
   it counts as success — re-sending after a dropped tunnel cannot create a
   second load of rice.
5. After 5 failed attempts an item stops retrying and is shown as "could not be
   sent" rather than retried forever in silence.

## Codes

Delivery and QC codes now carry a two-character device tag: `DL-450652-D5`.
Two phones offline in the same second cannot mint the same code. The tag is
derived from a device id kept in `localStorage`.

## The service worker

`public/sw.js`, hand-written and registered from `AppHeader`. It is NOT
vite-plugin-pwa: the Lovable vite config wrapper breaks if plugins are added to
it, so the cache is managed in plain JS where nothing can collide with the
build. It is disabled in dev so it cannot fight HMR.

- App files: cache first (they are content-hashed, so a cached copy is never stale).
- Navigations: network first, falling back to the cached shell.
- Supabase and other cross-origin calls: never cached. Stale farm data that
  looks live is worse than an honest failure.

## Known limits

- The login token still expires. A phone offline for many days will come back
  logged out holding a queue it cannot send; the records are safe in IndexedDB
  but need a login before they drain.
- Reference data (farmers, contracts, prices) is not yet pre-cached, so the
  contract picker needs the page to have been loaded while online. Caching that
  read-side is the next step.
- Photos are not queued (there is no upload wiring anywhere in the app yet).

## Installing it as an app

`public/manifest.webmanifest` makes "Add to Home Screen" produce a standalone
app window with the BRM icon rather than a browser bookmark:

- Android/Chrome: a real install prompt; opens without browser chrome.
- iOS/Safari: Share -> Add to Home Screen. iOS ignores the manifest's display
  mode, which is why `apple-mobile-web-app-capable` and `apple-touch-icon` are
  also set.

Icons are generated from `public/brm-agro-logo.png` on the app's paper colour
(the mark is navy and green, drawn for a light ground — on the brand green it
loses contrast). The maskable icon carries extra padding because Android
launchers crop to a circle.

Opening from the home screen starts at `/dashboard`. A "Record delivery"
shortcut is declared for a long-press on the icon.
