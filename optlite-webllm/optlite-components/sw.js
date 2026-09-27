// sw.js — Service Worker for OPT Mentor
//
// Purpose: make the page an installable PWA (Chrome's installability criteria
// require a controlling service worker that implements a fetch handler) AND
// provide reliable cache-busting so a deploy reaches returning users WITHOUT
// them clearing their browser cache.
//
// Why this file exists for BOTH reasons:
//  - Installability: a controlling SW with a fetch handler (pass-through below).
//  - Cache-busting: sw.js is served with `Cache-Control: no-cache`, so the
//    browser RE-VALIDATES it on every navigation. We stamp a BUILD_VERSION into
//    this file at build time (see Dockerfile) derived from the content-hashed
//    bundle names. When a deploy changes any bundle, BUILD_VERSION changes, so
//    this file's bytes differ from the cached copy -> the browser treats it as a
//    new SW version -> the page's registration handler (see *.html templates)
//    reloads once, pulling the fresh (no-store) HTML -> new bundle -> new CSS.
//    A returning user who was pinned to an old build therefore self-heals with
//    no manual cache clearing.
//
// OPT Mentor runs Python via Pyodide (optworker.mjs), which does NOT need
// SharedArrayBuffer, so — unlike OPT_CPP's sw.js — this worker does not inject
// COOP/COEP headers, decompress the xeus kernel, or cache anything. The fetch
// handler forwards every request to the network, so runtime behaviour is
// unchanged; /ai-proxy/ SSE streaming is preserved (fetch(request) streams).
//
// No paths are hardcoded: registration uses the relative './sw.js' and the
// scope is derived by the browser from where this script is served, so it works
// identically under /OPT_Mentor/, /OPT_Mentor_/ (flex), and the GitHub Pages root.
//
// The version constant below is stamped at build time by the Dockerfile, which
// computes it from the emitted bundle names.
const BUILD_VERSION = "__BUILD_VERSION__";

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pure pass-through: serve the network response as-is (same result a browser
  // would get without a service worker). The /ai-proxy/ SSE stream is unaffected
  // because fetch(request) preserves streaming.
  event.respondWith(fetch(event.request));
});
