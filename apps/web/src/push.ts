import { getPushConfig, registerPushDevice, removePushDevice } from "./api/push";

/** Phone notifications need a service worker, the Push API and permission; iPhones only offer them to an installed app. */
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// The device remembers which person turned notifications on, so a shared phone only buzzes for that person.
const flagKey = (username: string) => `hrpayroll.push.${username.toLowerCase()}`;
const ENDPOINT_KEY = "hrpayroll.pushEndpoint";

function readFlag(username: string): boolean {
  try {
    return localStorage.getItem(flagKey(username)) === "1";
  } catch {
    return false;
  }
}

function writeFlag(username: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(flagKey(username), "1");
    else localStorage.removeItem(flagKey(username));
  } catch {
    // Without storage the switch simply starts off next time.
  }
}

function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type PushState = "unavailable" | "off" | "on" | "blocked";

/** Whether notifications are on for this person on this device; re-registers the device after a fresh sign-in. */
export async function readPushState(username: string): Promise<PushState> {
  if (!pushSupported()) return "unavailable";
  const config = await getPushConfig().catch(() => null);
  if (!config?.enabled) return "unavailable";
  if (Notification.permission === "denied") return "blocked";
  if (!readFlag(username) || Notification.permission !== "granted") return "off";
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return "off";
  // The server forgets the device on sign-out; tell it again now that this person is back.
  await registerPushDevice(subscription.toJSON()).catch(() => undefined);
  try {
    localStorage.setItem(ENDPOINT_KEY, subscription.endpoint);
  } catch {
    // Not essential.
  }
  return "on";
}

export async function enablePush(username: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const config = await getPushConfig();
  if (!config.enabled) return "unavailable";
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(config.publicKey) }));
  await registerPushDevice(subscription.toJSON());
  writeFlag(username, true);
  try {
    localStorage.setItem(ENDPOINT_KEY, subscription.endpoint);
  } catch {
    // Not essential.
  }
  return "on";
}

export async function disablePush(username: string): Promise<PushState> {
  writeFlag(username, false);
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await removePushDevice(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  }
  return "off";
}

/**
 * Called as the person signs out, before the session is cleared: the server stops sending to this device so the next
 * person on the phone does not get their notifications. Fire-and-forget; the request starts immediately.
 */
export function forgetDeviceOnSignOut(): void {
  let endpoint: string | null = null;
  try {
    endpoint = localStorage.getItem(ENDPOINT_KEY);
  } catch {
    return;
  }
  if (endpoint) void removePushDevice(endpoint).catch(() => undefined);
}
