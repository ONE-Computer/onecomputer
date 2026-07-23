const VERSION = "onecomputer-companion-sw-0.1";
const COMPANION_PATH = "/companion?from=notification";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
  ]));
});

self.addEventListener("push", (event) => {
  let validHint = false;
  try {
    const payload = event.data?.json();
    validHint = payload?.version === "1"
      && payload?.event === "approval-pending"
      && Object.keys(payload).length === 2;
  } catch {
    validHint = false;
  }
  if (!validHint) return;
  event.waitUntil(self.registration.showNotification("Approval requested", {
    body: "Open ONEComputer Companion to review a protected action.",
    tag: "onecomputer-approval-pending",
    renotify: true,
    requireInteraction: true,
    data: { path: COMPANION_PATH, version: VERSION },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).pathname === "/companion");
    if (existing) {
      await existing.navigate(COMPANION_PATH);
      return existing.focus();
    }
    return self.clients.openWindow(COMPANION_PATH);
  })());
});
