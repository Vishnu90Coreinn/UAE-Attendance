import { useCallback, useEffect, useState } from "react";
import { disablePush, enablePush, pushSupported, readPushState, type PushState } from "./push";

/** The "Turn on / off notifications" switch shared by the desktop account menu and the phone's account sheet. */
export function usePushToggle(username: string | undefined) {
  const [state, setState] = useState<PushState>("unavailable");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!username || !pushSupported()) return;
    let cancelled = false;
    readPushState(username)
      .then((next) => !cancelled && setState(next))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [username]);

  const toggle = useCallback(async () => {
    if (!username) return;
    setBusy(true);
    try {
      setState(state === "on" ? await disablePush(username) : await enablePush(username));
    } catch {
      setState(await readPushState(username).catch(() => "off" as PushState));
    } finally {
      setBusy(false);
    }
  }, [username, state]);

  const label = state === "on" ? "Turn off notifications" : state === "blocked" ? "Notifications blocked in browser" : "Turn on notifications";
  return { state, busy, toggle, label, visible: state !== "unavailable" };
}
