// Optional same-origin host adapter. Plain static websites never probe an absent API.
export class CloudSaves {
  constructor({
    enabled = !!document.querySelector('meta[name="ffvi-host"]'),
    fetcher = fetch,
  } = {}) {
    this.enabled = enabled;
    this.fetcher = fetcher.bind(globalThis);
    this.serverId = null;
  }
  async request(url, options) {
    const response = await this.fetcher(url, {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
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
      throw Object.assign(Error("登录已过期，请重新登录；本机存档仍保留"), { status: 401 });
    this.serverId = value.serverId;
    return true;
  }
  async list() {
    const { value } = await this.request("/api/saves");
    if (value.serverId !== this.serverId) throw Error("服务器身份已变化，同步暂停以保护本机进度");
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
}
