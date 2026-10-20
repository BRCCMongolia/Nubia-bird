// Nubia Bird: офлайн ажиллуулах service worker. Шинэ хувилбар гаргахад VERSION-ийг өөрчилнө.
const VERSION = "nubia-1.2.1";
const SHELL = ["./", "index.html", "styles.css", "manifest.webmanifest",
  "species.js", "data.js", "core.js", "store.js", "map.js", "ui.js", "export.js", "app.js",
  "lib/leaflet.js", "lib/leaflet.css",
  "fonts/golos-text-cyrillic-wght-normal.woff2", "fonts/golos-text-cyrillic-ext-wght-normal.woff2", "fonts/golos-text-latin-wght-normal.woff2",
  "img/grid.jpg", "img/nubia.png", "img/brcc.jpg", "img/gombobaatar.jpg",
  "img/m1.jpg", "img/m2.jpg", "img/m3.jpg", "img/m4.jpg", "img/m5.jpg",
  "img/m1-s.jpg", "img/m2-s.jpg", "img/m3-s.jpg", "img/m4-s.jpg", "img/m5-s.jpg",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-180.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== "nubia-tiles").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Хиймэл дагуулын зураг: кэшээс, байхгүй бол татаж хадгална
  if (u.hostname === "server.arcgisonline.com") {
    e.respondWith(caches.open("nubia-tiles").then(async c => {
      const hit = await c.match(e.request.url); if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok) c.put(e.request.url, r.clone()); return r; }
      catch (err) { return new Response("", { status: 504 }); }
    }));
    return;
  }
  if (u.origin !== location.origin) return;
  // Аппын файлууд: кэшээс шууд, ард нь шинэчилнэ
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
