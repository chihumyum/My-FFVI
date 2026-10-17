import {
  Application,
  Assets,
  Container,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TextureStyle,
} from "pixi.js";

const WIDTH = 320;
const HEIGHT = 180;
const HORIZONTAL = 0x80000000;
const VERTICAL = 0x40000000;
const DIAGONAL = 0x20000000;
const TEXTURE_BUDGET = 192 * 1024 * 1024;

function container(label) {
  return new Container({ label });
}

function pooledSprite(pool, parent, index) {
  if (!pool[index]) {
    const sprite = new Sprite({ texture: Texture.EMPTY, roundPixels: true });
    sprite.anchor.set(0.5, 1);
    parent.addChild(sprite);
    pool[index] = sprite;
  }
  return pool[index];
}

function hideUnused(pool, count) {
  for (let i = count; i < pool.length; i++) pool[i].visible = false;
}

/** Read-only presentation of game state. The caller owns simulation and frame scheduling. */
export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.app = new Application();
    this.world = container("world");
    this.world.accessibleChildren = false;
    this.layers = {
      far: container("far"),
      mapLayers: container("map-layers"),
      actors: container("actors"),
      near: container("near"),
      effects: container("effects"),
      ui: container("ui-1920x1080"),
    };
    this.layers.mapLayers.sortableChildren = true;
    this.layers.near.sortableChildren = true;
    // PR scene_title: CameraFieldMain/CameraTileMap orthographic size 90;
    // CanvasScaler referenceResolution 1920x1080, at six UI units per world pixel.
    this.referenceResolution = Object.freeze({
      world: Object.freeze({ width: WIDTH, height: HEIGHT, orthographicSize: 90 }),
      ui: Object.freeze({ width: 1920, height: 1080 }),
      source: "PR scene_title CameraFieldMain/CameraTileMap and CanvasScaler",
    });
    this.layers.ui.scale.set(1 / 6);
    for (const key of ["far", "mapLayers", "actors", "near", "effects"])
      this.world.addChild(this.layers[key]);
    this.app.stage.addChild(this.world, this.layers.ui);
    this.world.filterArea = new Rectangle(0, 0, WIDTH, HEIGHT);
    this._textures = new Map();
    this._textureSources = new Map();
    this._unloadingSources = new Map();
    this._estimatedTextureBytes = 0;
    this._evictedPages = 0;
    this._textureBudgetDirty = false;
    this._atlasViews = new Set();
    this._assetImages = Object.create(null);
    this._assetBaseURL = "";
    this._assetGeneration = 0;
    this._crops = new Map();
    this._mapMetadata = new WeakMap();
    this._tileLayers = [];
    this._fieldSprites = [];
    this._battleSprites = [];
    this._battleNames = [];
    this._frameIntervals = [];
    this._renderTimes = [];
    this._warnings = [];
    this._warned = new Set();
    this._shake = null;
    this._flash = null;
    this._previousFrame = 0;
    this._frameCount = 0;
    this._visibleTiles = 0;
    this._visibleActors = 0;
    this._ready = false;
  }

  async init() {
    TextureStyle.defaultOptions.scaleMode = "nearest";
    await this.app.init({
      canvas: this.canvas,
      width: WIDTH,
      height: HEIGHT,
      resolution: 1,
      autoDensity: false,
      autoStart: false,
      sharedTicker: false,
      preference: ["webgl"],
      antialias: false,
      roundPixels: true,
      background: "#080e1b",
      accessibilityOptions: {
        enabledByDefault: true,
        activateOnTab: true,
        deactivateOnMouseMove: false,
      },
    });
    // Pixi 8.22.0 init removes its postrender listener after enabling the system.
    // Re-enable through the public API once initialization has finished.
    this.app.renderer.accessibility?.setAccessibilityEnabled(false);
    this.app.renderer.accessibility?.setAccessibilityEnabled(true);
    this.canvas.style.imageRendering = "pixelated";
    this._background = new Sprite(Texture.WHITE);
    this._background.tint = 0x172638;
    this._background.width = WIDTH;
    this._background.height = HEIGHT;
    this._background.visible = false;
    this._battleBackground = new Sprite({ texture: Texture.EMPTY, roundPixels: true });
    this._battleBackground.visible = false;
    this.layers.far.addChild(this._background, this._battleBackground);
    this._fade = new Sprite(Texture.WHITE);
    this._fade.tint = 0x000000;
    this._fade.width = WIDTH;
    this._fade.height = HEIGHT;
    this._fade.visible = false;
    this.layers.effects.addChild(this._fade);
    this._flashSprite = new Sprite(Texture.WHITE);
    this._flashSprite.width = WIDTH;
    this._flashSprite.height = HEIGHT;
    this._flashSprite.visible = false;
    this.layers.effects.addChild(this._flashSprite);
    this._ready = true;
    this._resize = () => this.resize();
    window.addEventListener("resize", this._resize);
    if (typeof ResizeObserver !== "undefined" && this.canvas.parentElement) {
      this._resizeObserver = new ResizeObserver(this._resize);
      this._resizeObserver.observe(this.canvas.parentElement);
    }
    this.resize();
    return this;
  }

  /** Keep CSS pixels and backing-store pixels at integer multiples of the source camera. */
  resize(availableWidth, availableHeight) {
    if (!this._ready) return;
    const parentWidth = this.canvas.parentElement?.clientWidth || window.innerWidth;
    const width = availableWidth ?? parentWidth;
    const height = availableHeight ?? Math.max(HEIGHT, window.innerHeight - 40);
    const scale = Math.max(1, Math.floor(Math.min(width / WIDTH, height / HEIGHT)));
    const resolution = scale * Math.max(1, Math.round(window.devicePixelRatio || 1));
    if (resolution !== this._resolution) {
      this.app.renderer.resize(WIDTH, HEIGHT, resolution);
      this._resolution = resolution;
    }
    this._displayScale = scale;
    this.canvas.style.width = `${WIDTH * scale}px`;
    this.canvas.style.height = `${HEIGHT * scale}px`;
  }

  resetPresentation() {
    this._shake = null;
    this._flash = null;
  }

  setFilters(filters) {
    this.world.filters = filters == null ? null : Array.isArray(filters) ? filters : [filters];
  }

  /** Optional build index; original PR URL keys remain untouched in game data. */
  setAssets(images, baseURL = "") {
    this._assetGeneration++;
    this._assetImages = images || Object.create(null);
    this._assetBaseURL = String(baseURL);
    for (const texture of this._crops.values()) texture.destroy(false);
    for (const texture of this._atlasViews) texture.destroy(false);
    this._crops.clear();
    this._atlasViews.clear();
    this._textures.clear();
    // Keep ownership of decoded pages across new games so the LRU can release
    // them; abandoning the records would leave them in Pixi's global Assets cache.
    for (const page of this._textureSources.values()) page.lastUsed = -1;
    this._textureBudgetDirty = true;
    return this;
  }

  getTexture(url) {
    return this._texture(url);
  }

  _warnOnce(key, message) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    this._warnings.push(message);
    console.warn(message);
  }

  /** Receives source presentation instructions after execution; never calls into the VM. */
  event(event) {
    if (event?.kind !== "presentation-command") return;
    const i = event.i || [];
    const r = event.r || [];
    const clock = {
      time: Number.isFinite(event.time) ? event.time : null,
      wall: performance.now() / 1000,
    };
    switch (event.name) {
      case "ShakeStop":
        this._shake = null;
        break;
      case "Shake":
      case "ShakeStart":
        if (event.name === "Shake" && !i[0]) {
          this._shake = null;
          break;
        }
        this._shake = {
          ...clock,
          amplitude: [1, 2, 4][i[1]] ?? 2,
          vertical: !!i[2],
        };
        this._warnOnce(
          "shake-parameters",
          "Shake: source start/stop is retained; strength 0/1/2 is approximated as 1/2/4 camera pixels, i2 selects the axis. Native frequency/ramp is not yet reproduced.",
        );
        break;
      case "Flash": {
        const channel = (index, fallback) =>
          Math.max(0, Math.min(255, Number(i[index] ?? fallback)));
        this._flash = {
          ...clock,
          color: (channel(0, 255) << 16) | (channel(1, 255) << 8) | channel(2, 255),
          alpha: channel(3, 255) / 255,
          duration: r[0] > 0 ? r[0] : 0.2,
        };
        break;
      }
      default:
        this._warnOnce(
          `presentation:${event.name}`,
          `Presentation command not drawn yet: ${event.name}`,
        );
    }
  }

  _drawEffects(game) {
    const age = (effect) =>
      Math.max(
        0,
        effect.time !== null && Number.isFinite(game?.time)
          ? game.time - effect.time
          : performance.now() / 1000 - effect.wall,
      );
    let x = 0;
    let y = 0;
    if (this._shake) {
      const offset = Math.round(Math.sin(age(this._shake) * 48) * this._shake.amplitude);
      if (this._shake.vertical) y = offset;
      else x = offset;
    }
    // Camera shake moves scenery/actors only. Full-screen overlays and UI remain fixed.
    for (const key of ["far", "mapLayers", "actors", "near"]) this.layers[key].position.set(x, y);
    if (this._flash) {
      const alpha = this._flash.alpha * Math.max(0, 1 - age(this._flash) / this._flash.duration);
      this._flashSprite.tint = this._flash.color;
      this._flashSprite.alpha = alpha;
      this._flashSprite.visible = alpha > 0;
      if (!alpha) this._flash = null;
    } else this._flashSprite.visible = false;
  }

  _texture(url) {
    if (!url) return null;
    let record = this._textures.get(url);
    if (!record) {
      const entry = this._assetImages[url];
      let sourceURL = url;
      if (entry) {
        const location = globalThis.location?.href || "http://localhost/";
        const directory = this._assetBaseURL ? this._assetBaseURL.replace(/\/?$/, "/") : "./";
        sourceURL = new URL(entry.file, new URL(directory, location)).href;
      }
      let source = this._textureSources.get(sourceURL);
      if (!source) {
        source = {
          url: sourceURL,
          texture: null,
          pending: true,
          bytes: 0,
          lastUsed: this._frameCount,
        };
        // An evicted page requested again must wait for unload to finish before
        // reloading. Otherwise Assets can hand back the texture being destroyed.
        source.promise = Promise.resolve(this._unloadingSources.get(sourceURL))
          .then(() => Assets.load(sourceURL))
          .then(
            (texture) => {
              texture.source.style.scaleMode = "nearest";
              source.texture = texture;
              source.pending = false;
              source.bytes = texture.source.pixelWidth * texture.source.pixelHeight * 4;
              this._estimatedTextureBytes += source.bytes;
              this._textureBudgetDirty = true;
              return texture;
            },
            (error) => {
              source.pending = false;
              throw error;
            },
          );
        this._textureSources.set(sourceURL, source);
      }
      const generation = this._assetGeneration;
      record = { texture: null, loading: true, failed: false, sourceURL };
      this._textures.set(url, record);
      source.promise
        .then((base) => {
          if (generation !== this._assetGeneration) return;
          let texture = base;
          if (entry) {
            const frame = entry.frame;
            if (
              !frame ||
              ![frame.x, frame.y, frame.w, frame.h].every(Number.isInteger) ||
              frame.x < 0 ||
              frame.y < 0 ||
              frame.w <= 0 ||
              frame.h <= 0 ||
              frame.x + frame.w > base.width ||
              frame.y + frame.h > base.height
            )
              throw new Error(`Invalid atlas frame for ${url}`);
            texture = new Texture({
              source: base.source,
              frame: new Rectangle(
                base.frame.x + frame.x,
                base.frame.y + frame.y,
                frame.w,
                frame.h,
              ),
            });
            this._atlasViews.add(texture);
          }
          record.texture = texture;
          record.loading = false;
        })
        .catch((error) => {
          record.loading = false;
          record.failed = true;
          this._warnOnce(`texture:${sourceURL}`, `Texture unavailable: ${url}: ${error.message}`);
        });
    }
    const source = this._textureSources.get(record.sourceURL);
    if (source) source.lastUsed = this._frameCount;
    return record.texture;
  }

  _evictPage(page) {
    const source = page.texture.source;
    this._textureSources.delete(page.url);
    this._estimatedTextureBytes -= page.bytes;
    for (const [url, record] of this._textures)
      if (record.sourceURL === page.url) this._textures.delete(url);
    for (const [key, texture] of this._crops)
      if (texture.source === source) {
        texture.destroy(false);
        this._crops.delete(key);
      }
    for (const texture of this._atlasViews)
      if (texture.source === source) {
        texture.destroy(false);
        this._atlasViews.delete(texture);
      }
    this._evictedPages++;
    const unloading = Promise.resolve()
      .then(() => Assets.unload(page.url))
      .catch((error) =>
        this._warnOnce(
          `unload:${page.url}`,
          `Texture unload failed: ${page.url}: ${error.message}`,
        ),
      )
      .finally(() => {
        if (this._unloadingSources.get(page.url) === unloading)
          this._unloadingSources.delete(page.url);
      });
    this._unloadingSources.set(page.url, unloading);
  }

  _trimTextureCache() {
    this._textureBudgetDirty = false;
    if (this._estimatedTextureBytes <= TEXTURE_BUDGET) return;
    const unused = [...this._textureSources.values()]
      .filter((page) => !page.pending && page.texture && page.lastUsed !== this._frameCount)
      .sort((a, b) => a.lastUsed - b.lastUsed || a.url.localeCompare(b.url));
    for (const page of unused) {
      this._evictPage(page);
      if (this._estimatedTextureBytes <= TEXTURE_BUDGET) break;
    }
    if (this._estimatedTextureBytes > TEXTURE_BUDGET)
      this._warnOnce(
        "texture-budget-scene",
        "The current scene uses more than the 192 MiB estimated decoded-texture budget; all current-frame pages are retained.",
      );
  }

  _crop(url, index, set, tileSize) {
    const base = this._texture(url);
    if (!base) return null;
    const w = set.tilewidth || tileSize;
    const h = set.tileheight || tileSize;
    const margin = set.margin || 0;
    const spacing = set.spacing || 0;
    const columns = set.columns || Math.floor((base.width - margin * 2 + spacing) / (w + spacing));
    const x = margin + (index % columns) * (w + spacing);
    const y = margin + Math.floor(index / columns) * (h + spacing);
    if (x < 0 || y < 0 || x + w > base.width || y + h > base.height) return null;
    const key = `${url}:${x},${y},${w},${h}`;
    let texture = this._crops.get(key);
    if (!texture) {
      texture = new Texture({
        source: base.source,
        frame: new Rectangle(base.frame.x + x, base.frame.y + y, w, h),
      });
      this._crops.set(key, texture);
    }
    return texture;
  }

  _metadata(map) {
    let metadata = this._mapMetadata.get(map);
    if (!metadata) {
      metadata = [...(map.tilesets || [])]
        .sort((a, b) => b.firstgid - a.firstgid)
        .map((set) => ({
          set,
          animations: new Map(
            (set.tiles || [])
              .filter((tile) => tile.animation?.length)
              .map((tile) => [tile.id, tile.animation]),
          ),
        }));
      this._mapMetadata.set(map, metadata);
    }
    return metadata;
  }

  _drawMap(game, data) {
    const map = game.map;
    if (!map) {
      for (const layer of this._tileLayers) layer.container.visible = false;
      hideUnused(this._fieldSprites, 0);
      return;
    }
    const tile = map.tileSize || 16;
    const focus = game.camera?.manual ? game.camera : game.player;
    const ox = Math.floor(
      Math.max(0, Math.min(map.width * tile - WIDTH, (focus?.x || 0) * tile - WIDTH / 2)),
    );
    const oy = Math.floor(
      Math.max(0, Math.min(map.height * tile - HEIGHT, (focus?.y || 0) * tile - HEIGHT / 2)),
    );
    const metadata = this._metadata(map);
    for (let li = 0; li < (map.layers || []).length; li++) {
      const layer = map.layers[li];
      let state = this._tileLayers[li];
      if (!state) {
        state = { container: container(`tile-layer-${li}`), sprites: [] };
        this._tileLayers[li] = state;
      }
      // Ceiling/upper art is the foreground plane; no game collision or actor state is changed.
      const parent = /(?:upper|ceil|near|foreground)/i.test(layer.name || "")
        ? this.layers.near
        : this.layers.mapLayers;
      if (state.container.parent !== parent) parent.addChild(state.container);
      state.container.zIndex = li;
      state.container.visible = true;
      state.container.alpha = layer.opacity ?? 1;
      let count = 0;
      if (layer.data) {
        const bottom = Math.min(layer.height, Math.ceil((oy + HEIGHT) / tile));
        const right = Math.min(layer.width, Math.ceil((ox + WIDTH) / tile));
        for (let y = Math.max(0, Math.floor(oy / tile)); y < bottom; y++) {
          for (let x = Math.max(0, Math.floor(ox / tile)); x < right; x++) {
            const raw = layer.data[y * layer.width + x] >>> 0;
            // Orthogonal Tiled maps also reserve bit 29 (hexagonal rotation).
            const gid = raw & 0x0fffffff;
            if (!gid) continue;
            const entry = metadata.find(({ set }) => set.firstgid <= gid);
            if (!entry) continue;
            const { set, animations } = entry;
            let index = gid - set.firstgid;
            const animation = animations.get(index);
            // Retain the previous renderer's animation clock during the foundation migration.
            if (animation) index = animation[Math.floor(game.time * 5) % animation.length].tileid;
            const texture = this._crop(map.textures?.[set.image], index, set, tile);
            if (!texture) continue;
            const sprite = pooledSprite(state.sprites, state.container, count++);
            sprite.texture = texture;
            sprite.anchor.set(0.5);
            sprite.position.set(x * tile + tile / 2 - ox, y * tile + tile / 2 - oy);
            const h = raw & HORIZONTAL ? -1 : 1;
            const v = raw & VERTICAL ? -1 : 1;
            if (raw & DIAGONAL) {
              sprite.rotation = Math.PI / 2;
              sprite.scale.set((tile / texture.width) * v, (-tile / texture.height) * h);
            } else {
              sprite.rotation = 0;
              sprite.scale.set((tile / texture.width) * h, (tile / texture.height) * v);
            }
            sprite.visible = true;
          }
        }
      }
      hideUnused(state.sprites, count);
      this._visibleTiles += count;
    }
    for (let i = (map.layers || []).length; i < this._tileLayers.length; i++)
      this._tileLayers[i].container.visible = false;
    let count = 0;
    const actors = [...(game.actors?.values() || []), game.player]
      .filter((actor) => actor && actor.visible !== false && actor !== game.camera)
      .sort((a, b) => a.y - b.y);
    const draw = (asset, animation, x, y) => {
      const char = data?.characters?.[asset?.toLowerCase()];
      if (!char?.sprites) return;
      const names = Object.keys(char.sprites);
      const frames = names.filter((name) => name.startsWith(`${animation || "Default"}_`));
      const key = frames.length
        ? frames[Math.floor(game.time * 5) % frames.length]
        : names.find((name) => name.startsWith("Default_")) || names[0];
      const info = char.sprites[key];
      const texture = this._texture(info?.file);
      if (!texture) return;
      const w = info.logicalWidth || info.width || texture.width;
      const h = info.logicalHeight || info.height || texture.height;
      if (x + w < ox || x - w > ox + WIDTH || y < oy || y - h > oy + HEIGHT) return;
      const sprite = pooledSprite(this._fieldSprites, this.layers.actors, count++);
      sprite.texture = texture;
      sprite.anchor.set(0, 1);
      sprite.position.set(Math.round(x - ox - w / 2), Math.round(y - oy));
      sprite.scale.set(w / texture.width, h / texture.height);
      sprite.visible = true;
    };
    for (const actor of actors) {
      if (actor.vehicle === 6)
        draw("mo_ff6_v006_c00", actor.animation, actor.x * tile, actor.y * tile + tile);
      if (actor.asset)
        draw(actor.asset, actor.animation, actor.x * tile + tile / 2, actor.y * tile + tile);
    }
    hideUnused(this._fieldSprites, count);
    this._visibleActors = count;
  }

  _drawBattle(game, battleData) {
    const battle = game.battle;
    this._background.visible = true;
    const background = this._texture(
      battleData?.backgrounds?.[battle.formation?.backgroundId]?.sprite?.url,
    );
    this._battleBackground.visible = !!background;
    if (background) {
      const key = `battle-background:${background.uid}`;
      let texture = this._crops.get(key);
      if (!texture) {
        const width = Math.min(WIDTH, background.width);
        const height = Math.min(HEIGHT, background.height);
        texture = new Texture({
          source: background.source,
          frame: new Rectangle(
            background.frame.x + Math.floor((background.width - width) / 2),
            background.frame.y + Math.floor((background.height - height) / 2),
            width,
            height,
          ),
        });
        this._crops.set(key, texture);
      }
      this._battleBackground.texture = texture;
      this._battleBackground.scale.set(1);
      this._battleBackground.position.set(
        Math.floor((WIDTH - texture.width) / 2),
        Math.floor((HEIGHT - texture.height) / 2),
      );
    }
    let count = 0;
    for (const [side, units] of [
      ["enemy", battle.enemies],
      ["player", battle.players],
    ]) {
      for (let n = 0; n < (units || []).length; n++) {
        const unit = units[n];
        if (unit.hp <= 0 || unit.hidden || unit.removed || unit.escaped) continue;
        const sprite = pooledSprite(this._battleSprites, this.layers.actors, count);
        let name = this._battleNames[count];
        if (!name) {
          name = new Text({
            text: "",
            style: { fontFamily: "system-ui", fontSize: 6, fill: 0xffffff },
          });
          name.roundPixels = true;
          name.anchor.set(0.5, 0);
          this.layers.actors.addChild(name);
          this._battleNames[count] = name;
        }
        const info =
          side === "player" && this._assetBaseURL && !this._assetImages[unit.sprite?.url]
            ? (unit.magitek
                ? battleData?.characters?.[unit.id]?.magitekSprite
                : battleData?.characters?.[unit.id]?.sprite) || unit.sprite
            : unit.sprite;
        const texture = this._texture(info?.url);
        // Keep source sprite pixels 1:1. This replaces the previous stretched
        // 960x640 composition with source-size art in the PR 320x180 camera.
        const baseX = side === "enemy" ? 60 + (n % 3) * 40 : 247 + (n % 2) * 25;
        const baseY = side === "enemy" ? 92 + Math.floor(n / 3) * 26 : 40 + n * 24;
        const x = Math.round(Math.max((texture?.width || 0) / 2 + 4, baseX));
        const y = Math.round(Math.max((texture?.height || 0) + 4, baseY));
        sprite.texture = texture || Texture.WHITE;
        sprite.tint = texture ? 0xffffff : side === "enemy" ? 0xae4058 : 0xb4c1ef;
        sprite.position.set(Math.round(x - (texture?.width || 13) / 2), y);
        sprite.anchor.set(0, 1);
        sprite.scale.set(texture ? 1 : 13, texture ? 1 : 18);
        sprite.visible = true;
        if (name.text !== unit.name) name.text = unit.name || "";
        name.position.set(x, y + 3);
        name.visible = true;
        count++;
      }
    }
    hideUnused(this._battleSprites, count);
    hideUnused(this._battleNames, count);
    this._visibleActors = count;
  }

  render(game, data, battleData) {
    if (!this._ready) return;
    const start = performance.now();
    if (this._previousFrame && start > this._previousFrame) {
      this._frameIntervals.push(start - this._previousFrame);
      if (this._frameIntervals.length > 120) this._frameIntervals.shift();
    }
    this._previousFrame = start;
    this._visibleTiles = 0;
    this._visibleActors = 0;
    const inBattle = !!game?.battle;
    this.layers.mapLayers.visible = !inBattle;
    this.layers.near.visible = !inBattle;
    this._background.visible = false;
    this._battleBackground.visible = false;
    if (inBattle) {
      hideUnused(this._fieldSprites, 0);
      this._drawBattle(game, battleData);
    } else {
      hideUnused(this._battleSprites, 0);
      hideUnused(this._battleNames, 0);
      this._drawMap(game || {}, data);
    }
    const fade = game?.fade;
    const progress = fade
      ? Math.max(0, Math.min(1, (game.time - fade.start) / (fade.duration || 0.000001)))
      : 0;
    this._fade.alpha = fade
      ? Math.max(0, Math.min(1, fade.from + (fade.to - fade.from) * progress))
      : 0;
    this._fade.visible = this._fade.alpha > 0;
    this._drawEffects(game);
    this.app.render();
    if (this._textureBudgetDirty || this._frameCount % 120 === 0) this._trimTextureCache();
    this._frameCount++;
    this._renderTimes.push(performance.now() - start);
    if (this._renderTimes.length > 120) this._renderTimes.shift();
  }

  metrics() {
    const mean = (values) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const textures = [...this._textures.values()];
    return {
      type: this._ready ? (this.app.renderer.type === 1 ? "webgl" : "unknown") : "uninitialized",
      webglVersion: this.app.renderer?.context?.webGLVersion || null,
      fps: this._frameIntervals.length ? 1000 / mean(this._frameIntervals) : 0,
      sampleFrames: this._frameIntervals.length,
      frames: this._frameCount,
      renderMs: mean(this._renderTimes),
      renderMaxMs: Math.max(0, ...this._renderTimes),
      logicalWidth: WIDTH,
      logicalHeight: HEIGHT,
      displayScale: this._displayScale || 1,
      resolution: this._resolution || 1,
      visibleTiles: this._visibleTiles,
      visibleActors: this._visibleActors,
      tileSprites: this._tileLayers.reduce((sum, layer) => sum + layer.sprites.length, 0),
      croppedTextures: this._crops.size,
      texturesReady: textures.filter((record) => record.texture).length,
      texturesLoading: textures.filter((record) => record.loading).length,
      texturesFailed: textures.filter((record) => record.failed).length,
      textureSources: this._textureSources.size,
      estimatedTextureBytes: this._estimatedTextureBytes,
      textureBudgetBytes: TEXTURE_BUDGET,
      textureBytesEstimate:
        "decoded page pixelWidth * pixelHeight * 4; excludes GPU copies, browser overhead and UI text",
      cachedPages: [...this._textureSources.values()].filter((page) => page.texture).length,
      evictedPages: this._evictedPages,
      atlasImages: this._atlasViews.size,
      warnings: [...this._warnings],
    };
  }

  destroy() {
    this._resizeObserver?.disconnect();
    if (this._resize) window.removeEventListener("resize", this._resize);
    this._assetGeneration++;
    for (const page of this._textureSources.values()) {
      if (page.texture) this._evictPage(page);
      else if (page.pending) page.promise.then(() => this._evictPage(page)).catch(() => {});
    }
    for (const texture of this._crops.values()) texture.destroy(false);
    for (const texture of this._atlasViews) texture.destroy(false);
    this._crops.clear();
    this._atlasViews.clear();
    this.app.destroy(
      { removeView: false },
      { children: true, texture: false, textureSource: false },
    );
    this._ready = false;
  }
}
