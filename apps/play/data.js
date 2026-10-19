// Fetch at map boundaries, before the synchronous VM can see a program.
// Missing packed programs throw instead of silently turning into empty scripts.
export class WebData {
  constructor(indexURL, { fetcher = globalThis.fetch.bind(globalThis), onLoad = () => {} } = {}) {
    this.indexURL = new URL(indexURL);
    this.baseURL = new URL("../", this.indexURL);
    this.fetcher = fetcher;
    this.onLoad = onLoad;
    this.cache = new Map();
    this.programChunks = new Set();
    this.boundaryChunks = new Set();
    this.loadedBytes = 0;
  }
  async json(file) {
    const url = new URL(file, this.baseURL).href;
    if (!this.cache.has(url))
      this.cache.set(
        url,
        (async () => {
          const response = await this.fetcher(url);
          if (!response.ok) throw Error(`Data ${response.status}: ${url}`);
          const bytes = await response.arrayBuffer();
          this.loadedBytes += bytes.byteLength;
          this.onLoad({ url, bytes: bytes.byteLength, totalBytes: this.loadedBytes });
          return JSON.parse(new TextDecoder().decode(bytes));
        })().catch((error) => {
          this.cache.delete(url);
          throw error;
        }),
      );
    return this.cache.get(url);
  }
  async open(saved = null) {
    this.index = await this.json(new URL(this.indexURL).href);
    const [core, battleData, navigation] = await Promise.all([
      this.json(this.index.core),
      this.json(this.index.battle),
      this.json(this.index.navigation),
    ]);
    this.programs = {};
    this.data = {
      ...structuredClone(core),
      navigation: structuredClone(navigation),
      programs: new Proxy(this.programs, {
        get: (target, key) => {
          if (typeof key === "string" && this.index.programFiles[key] && !(key in target))
            throw Error(`Program ${key} was not preloaded at the map boundary`);
          return Reflect.get(target, key);
        },
      }),
    };
    this.battleData = structuredClone(battleData);
    if (saved) await this.prepareSave(saved);
    return { data: this.data, battleData: this.battleData };
  }
  async ensurePrograms(ids, boundary = false) {
    const files = new Set(ids.map((id) => this.index.programFiles[id]).filter(Boolean));
    if (boundary) for (const file of files) this.boundaryChunks.add(file);
    // Keep plain static servers and their small connection queues usable too.
    const queue = [...files];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let file; (file = queue.shift());) {
          if (this.programChunks.has(file)) continue;
          const programs = await this.json(file);
          Object.assign(this.programs, structuredClone(programs));
          this.programChunks.add(file);
        }
      }),
    );
  }
  async loadMap(id) {
    const file = this.index.maps[id];
    if (!file) throw Error(`Missing packed PR map ${id}`);
    const [map] = await Promise.all([
      this.json(file),
      this.ensurePrograms(this.index.mapPrograms[id], true),
    ]);
    return structuredClone(map);
  }
  async prepareSave(saved) {
    const ids = new Set();
    const visit = (value, key = "") => {
      if (typeof value === "string") {
        const id = this.data.byMap[saved.mapId]?.[value] ?? this.data.global[value];
        if (id !== undefined) ids.add(String(id));
      }
      if (key === "program" && this.index.programFiles[value]) ids.add(String(value));
      if (value && typeof value === "object")
        for (const [k, v] of Object.entries(value)) visit(v, k);
    };
    visit(saved);
    await this.ensurePrograms([...ids], true);
  }
  // The frozen automatic route inspects remote maps and scripts. Only that debug
  // regression mode asks for every program; ordinary play uses map closures.
  async preloadRegression() {
    await this.ensurePrograms(Object.keys(this.index.programFiles));
  }
}
export const webIndexURL = () =>
  new URL(
    document.querySelector('meta[name="ffvi-data-index"]')?.content || "data/index.json",
    document.baseURI,
  );
