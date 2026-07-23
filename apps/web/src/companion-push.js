const base64urlToBytes = (value) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const browserFamily = () => {
  const userAgent = navigator.userAgent;
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) return "chrome";
  if (/Safari\//.test(userAgent)) return "safari";
  return "other";
};

const platform = () => {
  const value = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  if (/Win/i.test(value)) return "windows";
  if (/Mac/i.test(value)) return /iPhone|iPad|iPod/.test(navigator.userAgent) ? "ios" : "macos";
  if (/Android/i.test(navigator.userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return "ios";
  if (/Linux/i.test(value)) return "linux";
  return "other";
};

export const companionPushSupport = () => {
  if (!window.isSecureContext) return { supported: false, reason: "Notifications require HTTPS or localhost." };
  if (!("serviceWorker" in navigator)) return { supported: false, reason: "This browser does not support service workers." };
  if (!("PushManager" in window) || !("Notification" in window)) return { supported: false, reason: "This browser does not support Web Push." };
  return { supported: true, permission: Notification.permission, browserFamily: browserFamily(), platform: platform() };
};

export async function enableCompanionPush(vapidPublicKey) {
  const support = companionPushSupport();
  if (!support.supported) throw new Error(support.reason);
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked. Allow them in this site’s browser settings, then try again."
      : "Notification permission was not granted.");
  }
  const registration = await navigator.serviceWorker.register("/companion-sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  await registration.update();
  const ready = await navigator.serviceWorker.ready;
  let subscription = await ready.pushManager.getSubscription();
  if (!subscription) {
    subscription = await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64urlToBytes(vapidPublicKey),
    });
  }
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }
  return {
    browserFamily: support.browserFamily,
    platform: support.platform,
    notificationPermission: permission,
    subscription: {
      endpoint: serialized.endpoint,
      expirationTime: serialized.expirationTime ?? null,
      keys: {
        p256dh: serialized.keys.p256dh,
        auth: serialized.keys.auth,
      },
    },
  };
}

export async function removeCompanionPush() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}
