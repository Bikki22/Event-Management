// Keeps tabs in sync: logging out in one tab logs out the others, logging in lets them restore.
export type AuthEvent = "login" | "logout";

const NAME = "book-event-auth";
let channel: BroadcastChannel | null = null;

function getChannel() {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  channel ??= new BroadcastChannel(NAME);
  return channel;
}

export function broadcastAuth(event: AuthEvent) {
  getChannel()?.postMessage(event);
}

export function onAuthBroadcast(handler: (event: AuthEvent) => void) {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (e: MessageEvent<AuthEvent>) => handler(e.data);
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}
