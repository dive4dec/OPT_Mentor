// sw.js — Service Worker for OPT Mentor
//
// Purpose: make the page an installable PWA (Chrome's installability criteria
// require a controlling service worker that implements a fetch handler).
//
// This is a deliberate MINIMAL / PASS-THROUGH worker. OPT Mentor runs Python via
// Pyodide (optworker.mjs), which does NOT need SharedArrayBuffer, so — unlike
// OPT_CPP's sw.js — it does not inject COOP/COEP headers, decompress the xeus-cpp
// kernel, or cache anything. The fetch handler forwards every request to the
// network exactly as it would go otherwise, so this worker changes NO behaviour;
// it exists solely to satisfy the "SW implements a fetch handler" installability
// criterion and to control the page (clients.claim) so the browser can offer the
// install UI.
//
// No paths are hardcoded: registration uses the relative './sw.js' and the
// scope is derived by the browser from where this script is served, so it works
// identically under /OPT_Mentor/, /OPT_Mentor_/ (flex), and the GitHub Pages root.
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
