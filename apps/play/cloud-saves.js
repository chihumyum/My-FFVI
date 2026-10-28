import { tr } from "../../src/play/i18n.js";
// Optional same-origin host adapter. Plain static websites never probe an absent API.
import { activeIdentity } from "./identity.js";
export class CloudSaves {
  constructor({
    enabled = !!document.querySelector('meta[name="ffvi-host"]'),
    fetcher = fetch,
  } = {}) {
    this.enabled = enabled;
    this.fetcher = fetcher.bind(globalThis);
    this.serverId = activeIdentity()?.serverId || null;
    this.identity = activeIdentity();
  }
  async request(url, options) {
    const response = await this.fetcher(url, {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(this.serverId ? { "X-FFVI-Account": this.serverId } : {}),
        ...options?.headers,
      },
    });
    const value = await response.json();
    if (!response.ok && response.status !== 409)
      throw Object.assign(Error(value.error || `HTTP ${response.status}`), {
        status: response.status,
      });
    return { status: response.status, value };
  }
  async connect() {
    if (!this.enabled) return false;
    const { value } = await this.request("/api/session");
    if (!value.authenticated)
      throw Object.assign(
        Error(tr("cloud_saves.session_expired_log_in_again_local_saves_are_retained")),
        { status: 401 },
      );
    if (this.serverId && this.serverId !== value.serverId)
      throw Object.assign(
        Error(tr("cloud_saves.save_identity_changed_reload_this_page_local_progress_i")),
        { status: 403 },
      );
    this.serverId = value.serverId;
    this.identity = value;
    return true;
  }
  async list() {
    const { value } = await this.request("/api/saves");
    if (value.serverId !== this.serverId)
      throw Error(tr("cloud_saves.server_identity_changed_sync_paused_to_protect_local_pr"));
    return value.saves;
  }
  async get(id, revision) {
    return (
      await this.request(`/api/saves/${encodeURIComponent(id)}${revision ? `/${revision}` : ""}`)
    ).value;
  }
  async put(record, baseRevision, mutationId) {
    const result = await this.request(`/api/saves/${encodeURIComponent(record.id)}`, {
      method: "PUT",
      body: JSON.stringify({ record, baseRevision, mutationId }),
    });
    return { conflict: result.status === 409, value: result.value.current || result.value };
  }
  async history(id) {
    return (await this.request(`/api/saves/${encodeURIComponent(id)}/history`)).value.versions;
  }
  async logout() {
    await this.request("/api/logout", { method: "POST", body: "{}" });
  }
  async recover(recoveryKey) {
    return (
      await this.request("/api/session", {
        method: "POST",
        body: JSON.stringify({ recoveryKey: recoveryKey.trim() }),
      })
    ).value;
  }
  async createIdentity() {
    return (await this.request("/api/identity", { method: "POST", body: "{}" })).value;
  }
}
