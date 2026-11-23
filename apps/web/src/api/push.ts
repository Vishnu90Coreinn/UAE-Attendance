import { apiGet, apiPost } from "./client";

export interface PushConfig {
  enabled: boolean;
  publicKey: string;
}

export const getPushConfig = () => apiGet<PushConfig>("/api/push/config");
export const registerPushDevice = (subscription: PushSubscriptionJSON) =>
  apiPost("/api/push/subscribe", { endpoint: subscription.endpoint, keys: subscription.keys });
export const removePushDevice = (endpoint: string) => apiPost("/api/push/unsubscribe", { endpoint });
