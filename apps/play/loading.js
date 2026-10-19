// Host-only loading UI. No VM state, saves or game clocks live here.
export class LoadingScreen {
  constructor(document) {
    this.panel = document.getElementById("boot-status");
    this.message = document.getElementById("boot-message");
    this.progress = document.getElementById("load-progress");
    this.detail = document.getElementById("load-detail");
    this.retry = document.getElementById("load-retry");
    this.indicator = document.createElement("div");
    this.indicator.id = "scene-loading";
    this.indicator.hidden = true;
    this.indicator.setAttribute("role", "status");
    this.indicator.innerHTML = '<span aria-hidden="true">◌</span>';
    document.body.append(this.indicator);
    this.jobs = new Map();
    this.active = false;
    this.onRetry = null;
    this.retry.onclick = () => this.onRetry?.();
    document.getElementById("load-reload").onclick = async (event) => {
      event.preventDefault();
      if (this.reloading) return;
      this.reloading = true;
      if (this.panel.dataset.state === "failed") {
        this.message.textContent = "重新下载游戏模块…";
        // Revalidate preload responses before a fresh document. WebKit kept
        // the aborted module response across an ordinary reload in acceptance.
        const urls = [...document.querySelectorAll('link[rel="modulepreload"]')].map(
          (link) => link.href,
        );
        await Promise.allSettled(
          urls.map((url) => fetch(url, { cache: "reload", signal: AbortSignal.timeout(15000) })),
        );
      }
      location.reload();
    };
  }
  begin(title, { boot = false } = {}) {
    if (!this.active) {
      this.jobs.clear();
      this.bytes = 0;
      this.since = performance.now();
    }
    this.active = true;
    this.title = title;
    this.panel.dataset.mode = boot ? "boot" : "scene";
    this.panel.dataset.state = "loading";
    this.panel.hidden = this.inGame && !boot;
    this.indicator.dataset.active = "true";
    this.indicator.setAttribute("aria-label", title);
    this.retry.hidden = true;
    this.message.textContent = title;
    this.progress.removeAttribute("value");
    this.detail.textContent = "准备资源…";
  }
  observe = ({ url, state, bytes = 0 }) => {
    if (!this.active) return; // Speculative fetches never open the loading UI.
    this.jobs.set(url, state);
    if (state === "complete") this.bytes += bytes;
    this.update();
  };
  update(textures = null) {
    if (!this.active || this.panel.dataset.state === "failed") return;
    const total = this.jobs.size;
    const complete = [...this.jobs.values()].filter((state) => state === "complete").length;
    const parts = [];
    if (total) parts.push(`数据 ${complete}/${total}`);
    if (this.bytes) parts.push(`${(this.bytes / 1048576).toFixed(1)} MB`);
    if (textures) parts.push(`贴图 ${textures.ready}/${textures.total}`);
    const max = total + (textures?.total || 0);
    if (max) {
      this.progress.max = max;
      this.progress.value = complete + (textures?.ready || 0);
    }
    const detail = parts.join(" · ") || "准备资源…";
    if (this.detail.textContent !== detail) this.detail.textContent = detail;
  }
  fail(error, retry = null) {
    this.indicator.dataset.active = "false";
    this.panel.hidden = false;
    this.panel.dataset.state = "failed";
    this.message.textContent = `加载失败：${error.message || error}`;
    this.detail.textContent = "本机存档仍保留。请检查网络后重试。";
    this.progress.removeAttribute("value");
    this.onRetry = retry;
    this.retry.hidden = !retry;
  }
  async task(title, work) {
    this.begin(title);
    for (;;) {
      try {
        return await work();
      } catch (error) {
        console.error("[loading]", error);
        await new Promise((resolve) => this.fail(error, resolve));
        this.begin(title);
      }
    }
  }
  finish() {
    this.active = false;
    this.panel.hidden = true;
    this.onRetry = null;
    this.indicator.dataset.active = "false";
    this.indicator.setAttribute("aria-label", "资源已就绪");
  }
  setInGame(enabled) {
    this.inGame = enabled;
    this.indicator.hidden = !enabled;
  }
  snapshot() {
    return {
      active: this.active,
      title: this.title,
      state: this.panel.dataset.state,
      detail: this.detail.textContent,
      files: this.jobs.size,
      bytes: this.bytes || 0,
    };
  }
}
export const loading = new LoadingScreen(document);
