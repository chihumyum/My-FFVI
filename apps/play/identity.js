// Host identity is selected before the game imports its local save library.
// The recovery key is a bearer secret, never a URL parameter or public user ID.
let active = null;
export const activeIdentity = () => active;
export const saveDatabaseName = () =>
  active && !active.legacy ? `ffvi-pr-saves:${active.serverId}` : "ffvi-pr-saves";
export const quickSaveKey = (boost) =>
  (boost ? "ffvi-play-test" : "ffvi-play") +
  (active && !active.legacy ? `:${active.serverId}` : "");
export function rememberIdentity(value, recoveryKey, { activate = true } = {}) {
  if (recoveryKey) {
    localStorage.setItem(`ffvi-recovery:${value.serverId}`, recoveryKey);
    localStorage.setItem("ffvi-recovery-active", recoveryKey);
  } else if (value.legacy) localStorage.removeItem("ffvi-recovery-active");
  if (activate) active = value;
}
export async function prepareIdentity() {
  if (!document.querySelector('meta[name="ffvi-identity"][content="anonymous"]')) return;
  const request = async (url, input) => {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      ...(input
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }
        : {}),
    });
    const value = await response.json();
    if (!response.ok) throw Error(value.error || "无法连接存档服务");
    return value;
  };
  let value = await request("/api/session");
  if (!value.authenticated) {
    const key = localStorage.getItem("ffvi-recovery-active");
    // A failed recovery must never silently create a different empty identity.
    value = key
      ? await request("/api/session", { recoveryKey: key })
      : await request("/api/identity", {});
  }
  rememberIdentity(value, value.recoveryKey);
}
