import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TextureStyle,
} from "pixi.js";

import { BattlePresentation } from "./battle-presentation.js";
import { OpeningMarch } from "./opening-march.js";
import { PRParticles } from "./particles.js";
import { EffectLibrary } from "./effects.js";
import { FieldPresentation } from "./field-presentation.js";
import { PRFilter } from "./pr-filters.js";
import { WaterMaterial } from "./water-material.js";
import { sceneFadeAlpha } from "./field-screen-effects.js";
import { RenderDiagnostics } from "./render-diagnostics.js";
import { sceneTextureBindings, detachTextureSource } from "./texture-ownership.js";
import {
  FieldAnimations,
  fieldActorParts,
  fieldTileRegions,
  sampleFieldTile,
} from "./field-animation.js";
import {
  fieldTilePlane,
  fieldTileOrder,
  fieldActorPlane,
  fieldActorOrder,
  fieldBodyOrder,
  fieldBodySegments,
  fieldActorPosition,
} from "./field-order.js";

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
    this.diagnostics = new RenderDiagnostics();
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
    this.layers.actors.sortableChildren = true;
    // PR scene_title: CameraFieldMain/CameraTileMap orthographic size 90;
    // CanvasScaler referenceResolution 1920x1080, at six UI units per world pixel.
    this.referenceResolution = Object.freeze({
      world: Object.freeze({ width: WIDTH, height: HEIGHT, orthographicSize: 90 }),
      battle: Object.freeze({ width: 384, height: 216, orthographicSize: 108 }),
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
    this._fieldActorLayers = Array.from({ length: 4 }, (_, plane) => {
      const layer = container(`field-actors-${plane}`);
      layer.zIndex = fieldActorOrder({ layer: plane });
      layer.sortableChildren = true;
      this.layers.mapLayers.addChild(layer);
      return layer;
    });
    this._fieldBodyLayers = Array.from({ length: 4 }, (_, plane) => {
      const layer = container(`field-body-${plane}`);
      layer.zIndex = fieldBodyOrder({ layer: plane });
      layer.sortableChildren = true;
      this.layers.mapLayers.addChild(layer);
      return layer;
    });
    this.fieldAnimations = new FieldAnimations((key, message, details) => {
      if (details?.category)
        this.diagnostics.record(details.category, { ...details, reason: message });
      else this._warnOnce(`field-animation:${key}`, message);
    });
    this._battleSprites = [];
    this._battleNames = [];
    this._battleTargets = [];
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
    this._width = WIDTH;
    this._height = HEIGHT;
    this._effectTasks = new Set();
    this._particleLayer = container("battle-particles");
    this.layers.effects.addChild(this._particleLayer);
    this.particles = new PRParticles({
      container: this._particleLayer,
      diagnostics: this.diagnostics,
      getTexture: (url, details) => this._texture(url, { entityId: "particle", ...details }),
      warn: (message) => this._warnOnce(`particles:${message}`, message),
    });
    this._battleSceneLayer = container("battle-background-prefab");
    this.backgroundParticles = new PRParticles({
      container: this._battleSceneLayer,
      diagnostics: this.diagnostics,
      getTexture: (url, details) =>
        this._texture(url, { entityId: "battle-background", ...details }),
      warn: (message) => this._warnOnce(`background:${message}`, message),
    });
    this.battlePresentation = new BattlePresentation({
      actors: this.layers.actors,
      effects: this.layers.effects,
      getTexture: (url, details) => this._texture(url, { entityId: "battle", ...details }),
      diagnostics: this.diagnostics,
      warn: (message) => this._warnOnce(`battle:${message}`, message),
      onEffect: (event, actor, target) => this._battleEffect(event, actor, target),
    });
    this.fieldPresentation = new FieldPresentation({
      layers: this.layers,
      diagnostics: this.diagnostics,
      getTexture: (url, details) => this._texture(url, { entityId: "scene", ...details }),
      warn: (key, message) => this._warnOnce(key, message),
      sampleActor: (actor, character, time) => this.fieldAnimations.sample(actor, character, time),
    });
    this.openingMarch = new OpeningMarch({
      parent: this.layers.near,
      getTexture: (url, details) => this._texture(url, details),
      sample: (actor, character, time) => this.fieldAnimations.sample(actor, character, time),
      warn: (key, message) => this._warnOnce(key, message),
      diagnostics: this.diagnostics,
    });
  }

  async init() {
    // A CSP-blocked Blob Worker can leave Pixi's capability probe unresolved.
    // Same-origin PNG atlases do not require a script worker; decode them using
    // the browser's createImageBitmap path without widening script-src.
    Assets.setPreferences({ preferWorkers: false });
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
      useBackBuffer: true,
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
    this.particles.setRenderer(this.app.renderer);
    this.backgroundParticles.setRenderer(this.app.renderer);
    const overlay = this.app.renderer.accessibility?.div;
    if (overlay) {
      overlay.classList.add("pixi-accessibility");
      // Pixi 8.22's CanvasObserver uses viewport coordinates, while our canvas
      // parent is positioned. A fixed overlay avoids applying that offset twice.
      Object.assign(overlay.style, {
        position: "fixed",
        top: "0px",
        left: "0px",
        transformOrigin: "0 0",
      });
    }
    this.canvas.style.imageRendering = "pixelated";
    this._background = new Sprite(Texture.WHITE);
    this._background.tint = 0x172638;
    this._background.width = WIDTH;
    this._background.height = HEIGHT;
    this._background.visible = false;
    this._battleBackground = new Sprite({ texture: Texture.EMPTY, roundPixels: true });
    this._battleBackground.visible = false;
    this.layers.far.addChild(this._background, this._battleBackground);
    this.layers.far.addChild(this._battleSceneLayer);
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
    this.setFilters([this.fieldPresentation.screenFilter]);
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
    const touchHeight = Number(
      this.canvas.parentElement?.style.getPropertyValue("--game-available-height"),
    );
    const height =
      availableHeight ??
      (touchHeight > 0 ? touchHeight : Math.max(HEIGHT, window.innerHeight - 40));
    const screenWidth = this._menuMode ? 1920 : this._width,
      screenHeight = this._menuMode ? 1080 : this._height,
      fit = Math.min(width / screenWidth, height / screenHeight),
      scale = this._menuMode ? Math.max(0.1, fit) : Math.max(1, Math.floor(fit)),
      resolution = this._menuMode
        ? scale * Math.max(1, window.devicePixelRatio || 1)
        : scale * Math.max(1, Math.round(window.devicePixelRatio || 1));
    if (
      resolution !== this._resolution ||
      screenWidth !== this._screenWidth ||
      screenHeight !== this._screenHeight
    ) {
      this.app.renderer.resize(screenWidth, screenHeight, resolution);
      this._resolution = resolution;
      this._screenWidth = screenWidth;
      this._screenHeight = screenHeight;
    }
    this._displayScale = scale;
    this.canvas.style.width = `${screenWidth * scale}px`;
    this.canvas.style.height = `${screenHeight * scale}px`;
  }

  // Menus use PR's full UI reference canvas and the physical viewport. The
  // game camera and its integer-pixel layout remain unchanged when closing it.
  setMenuMode(enabled) {
    if (this._menuMode === Boolean(enabled)) return;
    this._menuMode = Boolean(enabled);
    document.body.classList.toggle("modern-menu", this._menuMode);
    this.layers.ui.scale.set(this._menuMode ? 1 : this._width / 1920);
    this.world.scale.set(this._menuMode ? 1920 / this._width : 1);
    this.canvas.style.imageRendering = this._menuMode ? "auto" : "pixelated";
    this.resize();
  }

  setBattlePresentation(catalog) {
    this.battlePresentation.setCatalog(catalog);
  }

  setFieldPresentation(catalog) {
    this.fieldPresentation.setCatalog(catalog);
  }

  setShaderCatalog(catalog) {
    this.shaderCatalog = catalog;
    this._backgroundShader ||= new PRFilter("Last/LastBackGround", {
      getTexture: (url, details) =>
        this._texture(url, { entityId: "background-shader", ...details }),
      warn: (message) => this._warnOnce("background:" + message, message),
    });
  }

  setEffectCatalog(catalog, json) {
    this.effectLibrary = new EffectLibrary(this.particles, catalog, json);
    this.backgroundLibrary = new EffectLibrary(this.backgroundParticles, catalog, json);
  }

  _battleEffect(event, actor, target) {
    if (event.abilityId === 1 && !event.result.hit) return;
    const library = this.effectLibrary;
    if (!library) {
      this.diagnostics.record("effect-catalog-missing", {
        entityId: event.actorIndex,
        resource: `ability:${event.abilityId}`,
      });
      return;
    }
    const battle = this.battlePresentation.battle;
    const unit = (event.actorSide === "player" ? battle.players : battle.enemies)[event.actorIndex];
    let effectId = library.catalog.abilities[event.abilityId];
    if (String(event.abilityId).startsWith("item:")) {
      const content = battle.data.contents[String(event.abilityId).slice(5)];
      effectId = library.catalog.items[content?.type_value];
    }
    if (event.abilityId === 1) {
      const content = battle.data.contents[unit?.equipment?.[0]];
      effectId = library.catalog.weapons[content?.type_id === 2 ? content.type_value : 1];
    }
    if (!effectId) return;
    const mapping = library.catalog.effectIds[effectId];
    this._warnOnce(
      "effect-anchors",
      "PR battle effect position/display types are retained; web currently anchors type1 at the actor and other effects at the target body. Choreography and sound offsets are approximated.",
    );
    const origin = mapping?.positionType === 1 ? actor : target;
    const position = { x: origin.x, y: origin.y - 14, mirror: !!actor.mirror };
    for (const id of event.result.critical && mapping?.criticalSE
      ? [mapping.criticalSE]
      : mapping?.se || [])
      this.onBattleSound?.(id);
    const context = { ...this.diagnostics.context };
    const task = library
      .play(effectId, position, () => this.battlePresentation.battle === battle)
      .catch((error) =>
        this.diagnostics.record(
          "effect-load-failed",
          {
            entityId: `${event.actorSide}:${event.actorIndex}`,
            resource: mapping?.asset || effectId,
            effectId,
            abilityId: event.abilityId,
            reason: error.message,
          },
          context,
        ),
      );
    this._effectTasks.add(task);
    task.finally(() => this._effectTasks.delete(task));
  }

  /** Visual-lab still frame: clocks and particles freeze here, never in src/play. */
  async captureBattleFrame(game, data, battleData, age = 0.5) {
    this._previewClock = performance.now() / 1000;
    this.render(game, data, battleData);
    await Promise.all([...this._effectTasks]);
    this.particles.update(age);
    this._previewClock += age;
    for (let pass = 0; pass < 3; pass++) {
      this.render(game, data, battleData);
      await Promise.all(
        [...this._textureSources.values()].filter((s) => s.pending).map((s) => s.promise),
      );
    }
    this.render(game, data, battleData);
  }

  _viewport(battle) {
    const width = battle ? this.battlePresentation.catalog?.camera.width || 384 : WIDTH;
    const height = battle ? this.battlePresentation.catalog?.camera.height || 216 : HEIGHT;
    if (width === this._width && height === this._height) return;
    this._width = width;
    this._height = height;
    this._resolution = null;
    this.layers.ui.scale.set(this._menuMode ? 1 : width / 1920);
    this.world.scale.set(this._menuMode ? 1920 / width : 1);
    this.world.filterArea = new Rectangle(0, 0, width, height);
    for (const s of [this._background, this._fade, this._flashSprite]) {
      s.width = width;
      s.height = height;
    }
    this.resize();
  }

  resetPresentation() {
    this.diagnostics.reset();
    this.fieldAnimations.reset();
    this.battlePresentation.clear();
    this.particles.clear();
    this.backgroundParticles.clear();
    this._battleSceneBattle = null;
    this._previewClock = null;
    this._battleExit = null;
    this._shake = null;
    this._flash = null;
    this.fieldPresentation.reset();
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

  getTexture(url, details) {
    return this._texture(url, { entityId: "ui", ...details });
  }

  captureFrame() {
    return this.app.renderer.extract.base64({
      target: this.app.stage,
      frame: new Rectangle(
        0,
        0,
        this._screenWidth || this._width,
        this._screenHeight || this._height,
      ),
      format: "png",
      resolution: this._resolution || 1,
      clearColor: "#080e1b",
    });
  }

  _warnOnce(key, message) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    this._warnings.push(message);
    console.warn(message);
  }

  /** Receives source presentation instructions after execution; never calls into the VM. */
  event(event) {
    this.fieldAnimations.event(event);
    this.fieldPresentation.event(event);
    if (event?.kind === "battle-end" && this.battlePresentation.battle) {
      const battle = this.battlePresentation.battle;
      this._battleExit = {
        until: performance.now() / 1000 + 1.5,
        battle: {
          ...battle,
          outcome: event.outcome,
          players: battle.players.map((u) => ({ ...u })),
          enemies: battle.enemies.map((u) => ({ ...u })),
        },
      };
      return;
    }
    if (["battle-action", "battle-party"].includes(event?.kind)) {
      this.battlePresentation.event(event);
      return;
    }
    if (event?.kind !== "presentation-command") return;
    const i = event.i || [];
    const r = event.r || [];
    const clock = {
      time: Number.isFinite(event.time) ? event.time : null,
      wall: performance.now() / 1000,
    };
    switch (event.name) {
      case "ColorFade":
      case "ScreenEffect":
      case "Water":
      case "BackdropColor":
      case "ChangeView":
      case "SysCall":
      // FieldAnimations consumes these above; the VM owns positions and the
      // renderer samples their authored clips without a second implementation.
      case "CueAnim":
      case "PlayAnim":
      case "SetPos":
      case "Move":
      case "MoveBirdView":
      case "MoveTo":
      case "Lerp":
      case "Route":
        break;
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

  _texture(url, details = {}) {
    if (!url) {
      if (details.required)
        this.diagnostics.record("texture-reference-missing", {
          ...details,
          resource: url ?? details.resource ?? null,
        });
      return null;
    }
    if (this._assetGeneration && !this._assetImages[url] && !/^(data:|blob:)/.test(url))
      this.diagnostics.record("atlas-entry-missing", { ...details, resource: url });
    let record = this._textures.get(url);
    if (!record) {
      const requestContext = { ...this.diagnostics.context };
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
              // Generated artwork previews have their own pages; pixel-game
              // atlases retain nearest sampling without mutating shared styles.
              texture.source.style.scaleMode = entry?.sampling || "nearest";
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
              throw Object.assign(new Error(`Invalid atlas frame for ${url}`), {
                category: "atlas-frame-invalid",
              });
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
          if (generation !== this._assetGeneration) return;
          record.loading = false;
          record.failed = true;
          record.error = error.message;
          record.errorCategory = error.category || "texture-load-failed";
          this.diagnostics.record(
            record.errorCategory,
            { ...details, resource: url, page: sourceURL, reason: record.error },
            requestContext,
          );
        });
    }
    if (record.failed)
      this.diagnostics.record(record.errorCategory, {
        ...details,
        resource: url,
        page: record.sourceURL,
        reason: record.error,
      });
    const source = this._textureSources.get(record.sourceURL);
    if (source) source.lastUsed = this._frameCount;
    return record.texture;
  }

  _evictPage(page) {
    const source = page.texture.source;
    // Inactive pools can remain in Pixi's cached batch instructions. Notify
    // their setters before destroying atlas views or their shared source.
    this._detachedTextureBindings =
      (this._detachedTextureBindings || 0) +
      detachTextureSource(this.app.stage, source, Texture.EMPTY);
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
    const held = new Set(
      sceneTextureBindings(this.app.stage, { visibleOnly: true }).map((binding) => binding.source),
    );
    this._retainedRenderPages = 0;
    for (const page of this._textureSources.values())
      if (held.has(page.texture?.source)) {
        if (page.lastUsed !== this._frameCount) this._retainedRenderPages++;
        page.lastUsed = this._frameCount;
      }
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

  _crop(url, index, set, tileSize, details = {}) {
    const base = this._texture(url, { required: true, ...details });
    if (!base) return null;
    const w = set.tilewidth || tileSize;
    const h = set.tileheight || tileSize;
    const margin = set.margin || 0;
    const spacing = set.spacing || 0;
    const columns = set.columns || Math.floor((base.width - margin * 2 + spacing) / (w + spacing));
    const x = margin + (index % columns) * (w + spacing);
    const y = margin + Math.floor(index / columns) * (h + spacing);
    if (x < 0 || y < 0 || x + w > base.width || y + h > base.height) {
      this.diagnostics.record("tile-frame-out-of-bounds", {
        ...details,
        resource: url,
        frameIndex: index,
        frame: { x, y, width: w, height: h },
        image: { width: base.width, height: base.height },
      });
      return null;
    }
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
    const viewWidth = this.fieldPresentation.flight ? 640 : WIDTH;
    const viewHeight = this.fieldPresentation.flight ? 640 : HEIGHT;
    const world = /^Map_100(?:10|20|30)/i.test(map.name);
    const loop = world ? (map.worldTerrain?.loopType ?? 3) : 0;
    const wrapX = !!(loop & 1),
      wrapY = !!(loop & 2);
    const focus = game.camera?.manual ? game.camera : game.player;
    const ox = Math.floor(
      wrapX
        ? (focus?.x || 0) * tile - viewWidth / 2
        : Math.max(
            0,
            Math.min(map.width * tile - viewWidth, (focus?.x || 0) * tile - viewWidth / 2),
          ),
    );
    const oy = Math.floor(
      wrapY
        ? (focus?.y || 0) * tile - viewHeight / 2
        : Math.max(
            0,
            Math.min(map.height * tile - viewHeight, (focus?.y || 0) * tile - viewHeight / 2),
          ),
    );
    const metadata = this._metadata(map);
    const tileRegions = fieldTileRegions(game);
    for (let li = 0; li < (map.layers || []).length; li++) {
      const layer = map.layers[li];
      let state = this._tileLayers[li];
      if (!state) {
        state = { container: container(`tile-layer-${li}`), sprites: [] };
        this._tileLayers[li] = state;
      }
      const parent = this.layers.mapLayers;
      if (state.container.parent !== parent) parent.addChild(state.container);
      state.container.zIndex = fieldTileOrder(layer);
      state.container.visible = layer.visible !== false;
      state.container.alpha = layer.opacity ?? 1;
      if (layer.sourceGroup === "WaterGroup") {
        state.water ||= new WaterMaterial({
          getTexture: (url, details) => this._texture(url, details),
          collectAll: () => this.diagnostics.acceptance,
          warn: (category, reason, details) =>
            this.diagnostics.record(category, {
              entityId: `map-layer:${li}`,
              resource: details.layer || layer.name,
              reason,
              ...details,
            }),
        });
        const available = state.water.update(layer.waterMaterial, {
          time: game.time || 0,
          x: ox,
          y: oy,
          scale: this.world.scale.x,
          layerName: layer.name,
          mapId: game.mapId,
          properties: this.fieldPresentation.water,
        });
        state.container.filters = available ? [state.water] : null;
        // Missing material metadata must produce a diagnostic, never controller blue.
        state.container.visible = state.container.visible && available;
      } else if (state.water) {
        state.container.filters = null;
        state.water.destroy();
        state.water = null;
      }
      const plane = fieldTilePlane(layer);
      let count = 0;
      if (layer.data) {
        const bottom = wrapY
          ? Math.ceil((oy + viewHeight) / tile)
          : Math.min(layer.height, Math.ceil((oy + viewHeight) / tile));
        const right = wrapX
          ? Math.ceil((ox + viewWidth) / tile)
          : Math.min(layer.width, Math.ceil((ox + viewWidth) / tile));
        for (
          let y = wrapY ? Math.floor(oy / tile) : Math.max(0, Math.floor(oy / tile));
          y < bottom;
          y++
        ) {
          for (
            let x = wrapX ? Math.floor(ox / tile) : Math.max(0, Math.floor(ox / tile));
            x < right;
            x++
          ) {
            const sx = ((x % layer.width) + layer.width) % layer.width;
            const sy = ((y % layer.height) + layer.height) % layer.height;
            const raw = layer.data[sy * layer.width + sx] >>> 0;
            // Orthogonal Tiled maps also reserve bit 29 (hexagonal rotation).
            const gid = raw & 0x0fffffff;
            if (!gid) continue;
            const entry = metadata.find(({ set }) => set.firstgid <= gid);
            if (!entry) {
              this.diagnostics.record("tileset-missing", {
                entityId: `tile:${li}:${sx},${sy}`,
                resource: `gid:${gid}`,
              });
              continue;
            }
            const { set, animations } = entry;
            let index = gid - set.firstgid;
            const animation = animations.get(index);
            if (animation) {
              index = sampleFieldTile(animation, game.time, sx, sy, plane, tileRegions);
            }
            const texture = this._crop(
              layer.waterMaterial?.controlTextures?.[set.image]?.url || map.textures?.[set.image],
              index,
              set,
              tile,
              {
                entityId: `tile:${li}:${sx},${sy}`,
                tileset: set.image,
              },
            );
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
      } else
        this.diagnostics.record("map-layer-data-missing", {
          entityId: `map-layer:${li}`,
          resource: layer.name,
          reason: "A declared runtime tile layer has no cell data",
        });
      hideUnused(state.sprites, count);
      this._visibleTiles += count;
    }
    for (let i = (map.layers || []).length; i < this._tileLayers.length; i++) {
      const state = this._tileLayers[i];
      state.container.visible = false;
      if (state.water) {
        state.container.filters = null;
        state.water.destroy();
        state.water = null;
      }
    }
    let count = 0;
    const actors = [...(game.actors?.values() || []), game.player]
      .filter((actor) => actor && actor.visible !== false && actor !== game.camera)
      .sort((a, b) => a.y - b.y);
    const draw = (actor, part, x, y, order) => {
      const { asset, hideFeet = 0, offsetY = 0 } = part;
      const char = data?.characters?.[asset?.toLowerCase()];
      const record = {
        side: "field",
        entityId: actor.id,
        kind: actor.kind,
        characterId: actor.characterId,
        asset,
        animation: actor.animation || "Default",
        direction: actor.direction,
        x: actor.x,
        y: actor.y,
        layer: actor.layer,
        vehicle: actor.vehicle,
        screen: { x: x - ox, y: y - oy },
        part: order,
        drawn: false,
      };
      this.frameActors.push(record);
      if (!char?.sprites) {
        record.reason = "missing-character-data";
        this.diagnostics.record(record.reason, { ...record, resource: asset });
        return;
      }
      const frame = this.fieldAnimations.sample(actor, char, game.time, asset);
      const info = frame?.info;
      Object.assign(record, { frame: frame?.name, clip: frame?.clip, resource: info?.file });
      if (!info) {
        record.reason = "missing-animation-frame";
        this.diagnostics.record(record.reason, { ...record, resource: asset });
        return;
      }
      let texture = this._texture(info?.file, {
        required: true,
        entityId: actor.id,
        asset,
        animation: frame.clip,
      });
      if (!texture) {
        record.reason = this._textures.get(info?.file)?.failed
          ? "texture-failed"
          : "texture-pending";
        return;
      }
      const w = info.logicalWidth || info.width || texture.width;
      const h = info.logicalHeight || info.height || texture.height;
      if (hideFeet)
        texture = this._crop(
          info.file,
          0,
          {
            tilewidth: texture.width,
            tileheight: Math.max(1, texture.height - Math.round((hideFeet * texture.height) / h)),
          },
          undefined,
          { entityId: actor.id, asset, animation: frame.clip },
        );
      if (x + w < ox || x - w > ox + viewWidth || y < oy || y - h > oy + viewHeight) {
        record.reason = "outside-viewport";
        return;
      }
      const pivotY = info.pivot?.[1] ?? 0,
        threshold = this.fieldPresentation.catalog?.maps[game.mapId]?.bodyThreshold,
        segments = fieldBodySegments({
          asset,
          height: h - hideFeet,
          pivotY,
          threshold: world || fieldActorPlane(actor) === 0 ? undefined : threshold,
          hideFeet,
          vehicle: actor.vehicle,
        });
      record.segments = [];
      if (segments.length > 1)
        this.diagnostics.record("field-head-body-mask-approximate", {
          entityId: actor.id,
          asset,
          resource: asset,
          reason:
            "PR Head/Body materials and explicit map body_threshold are preserved; cropped passes straddle the matching tile plane. Native one/two-upper-texture masking and depth offsets remain approximated. Maps without a declared threshold keep their existing full sprite.",
        });
      for (const segment of segments) {
        const parent = (segment.name === "body" ? this._fieldBodyLayers : this._fieldActorLayers)[
            fieldActorPlane(actor)
          ],
          sprite = pooledSprite(this._fieldSprites, parent, count++);
        let partTexture = texture;
        const sourceTop = Math.round((segment.top * texture.height) / (h - hideFeet)),
          sourceHeight = Math.round((segment.height * texture.height) / (h - hideFeet));
        if (sourceTop || sourceHeight !== texture.height) {
          const key = `${info.file}:body-split:${sourceTop}:${sourceHeight}:${texture.frame.y}`;
          partTexture = this._crops.get(key);
          if (!partTexture) {
            partTexture = new Texture({
              source: texture.source,
              frame: new Rectangle(
                texture.frame.x,
                texture.frame.y + sourceTop,
                texture.width,
                sourceHeight,
              ),
            });
            this._crops.set(key, partTexture);
          }
        }
        if (sprite.parent !== parent) parent.addChild(sprite);
        sprite.zIndex = actor.y * tile + order * 0.01;
        sprite.texture = partTexture;
        sprite.anchor.set(info.pivot?.[0] ?? 0.5, 0);
        sprite.position.set(
          Math.round(x - ox + (frame.offsetx || 0)),
          Math.round(
            y -
              oy -
              offsetY -
              hideFeet -
              (frame.offsety || 0) -
              (h - hideFeet) * (1 - pivotY) +
              segment.top,
          ),
        );
        sprite.scale.set(
          ((frame.flip ? -1 : 1) * w) / partTexture.width,
          segment.height / partTexture.height,
        );
        sprite.alpha = frame.alpha ?? 1;
        sprite.tint = frame.tint ?? 0xffffff;
        sprite.blendMode = "normal";
        sprite.blendMode = this.fieldPresentation.actorBlendMode(asset, char);
        sprite.visible = true;
        record.segments.push({ ...segment, order: parent.zIndex });
      }
      record.drawn = true;
      record.bounds = {
        x: x - ox + (frame.offsetx || 0) - w * (info.pivot?.[0] ?? 0.5),
        y: y - oy - offsetY - hideFeet - (frame.offsety || 0) - (h - hideFeet) * (1 - pivotY),
        width: w,
        height: h - hideFeet,
      };
    };
    for (const actor of actors) {
      if (this.fieldPresentation.flight && actor === game.player) continue;
      const position = fieldActorPosition(actor, tile);
      const parts = fieldActorParts(actor);
      if (!parts.length && (actor === game.player || [6, 10, 14, 17].includes(actor.kind)))
        this.frameActors.push({
          side: "field",
          entityId: actor.id,
          asset: actor.asset,
          animation: actor.animation,
          x: actor.x,
          y: actor.y,
          layer: actor.layer,
          drawn: false,
          reason: "missing-character-asset",
        });
      if (!parts.length && (actor === game.player || [6, 10, 17].includes(actor.kind)))
        this.diagnostics.record("missing-character-asset", {
          entityId: actor.id,
          resource: `character:${actor.characterId ?? actor.id}`,
          animation: actor.animation,
        });
      for (const [order, part] of parts.entries()) draw(actor, part, position.x, position.y, order);
    }
    hideUnused(this._fieldSprites, count);
    this._visibleActors = count;
    this.fieldPresentation.draw(game, { x: ox, y: oy }, data);
    if (this.fieldPresentation.flightFrame) {
      this.frameActors.push(this.fieldPresentation.flightFrame);
      if (this.fieldPresentation.flightFrame.drawn) this._visibleActors++;
    }
  }

  _drawBattle(game, battleData) {
    const battle = game.battle;
    const asset = this.backgroundLibrary?.catalog.backgrounds?.[battle.formation?.backgroundId];
    const authored = asset && this.backgroundLibrary.catalog.files[asset];
    this._battleSceneLayer.visible = !!authored;
    if (this._battleSceneBattle !== battle) {
      this.backgroundParticles.clear();
      this._battleSceneBattle = battle;
      if (authored) {
        const context = { ...this.diagnostics.context };
        const task = this.backgroundLibrary
          .play(
            asset,
            {
              x: this._width / 2,
              y: this._height / 2,
              duration: Infinity,
              seed: battle.formation.backgroundId,
            },
            () => this._battleSceneBattle === battle,
          )
          .catch((error) =>
            this.diagnostics.record(
              "battle-background-prefab-failed",
              {
                entityId: "battle-background",
                resource: asset,
                reason: error.message,
              },
              context,
            ),
          );
        this._effectTasks.add(task);
        task.finally(() => this._effectTasks.delete(task));
      }
    }
    if (this._backgroundShader) {
      const final = [47, 48, 49, 50].includes(battle.formation?.backgroundId);
      this._battleBackground.filters = final && !authored ? [this._backgroundShader] : null;
      this._battleSceneLayer.filters = final && authored ? [this._backgroundShader] : null;
      if (final)
        this._backgroundShader.update(this._previewClock ?? performance.now() / 1000, {
          width: this._width,
          height: this._height,
        });
    }
    this._background.visible = true;
    const background = this._texture(
      battleData?.backgrounds?.[battle.formation?.backgroundId]?.sprite?.url,
      { entityId: "battle-background", required: battle.formation?.backgroundId > 0 },
    );
    this._battleBackground.visible = !!background && !authored;
    if (background) {
      const key = `battle-background:${background.uid}`;
      let texture = this._crops.get(key);
      if (!texture) {
        const width = Math.min(this._width, background.width);
        const height = Math.min(this._height, background.height);
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
        Math.floor((this._width - texture.width) / 2),
        Math.floor((this._height - texture.height) / 2),
      );
    }
    hideUnused(this._battleSprites, 0);
    hideUnused(this._battleNames, 0);
    this._visibleActors = this.battlePresentation.draw(
      battle,
      battleData,
      this._previewClock ?? performance.now() / 1000,
    );
    let count = 0;
    for (const [key, row] of this.battlePresentation.units) {
      const [side, rawIndex] = key.split(":"),
        index = Number(rawIndex),
        selectable = row.container.visible && this.canSelectBattleTarget?.(side, index);
      const unit = (side === "player" ? battle.players : battle.enemies)[index];
      this.frameActors.push({
        side,
        entityId: unit?.id,
        index,
        slot: unit?.slot,
        name: unit?.name,
        ...row.renderInfo,
        drawn: row.container.visible,
        screen: { x: row.container.x, y: row.container.y },
        mirror: row.container.scale.x < 0,
      });
      row.container.eventMode = selectable ? "static" : "auto";
      row.container.interactiveChildren = false;
      row.container.cursor = selectable ? "pointer" : "default";
      if (!row.targetTap) {
        row.targetTap = () => {
          if (this.canSelectBattleTarget?.(side, index)) this.onBattleTarget?.(side, index);
        };
        row.container.on("pointertap", row.targetTap);
      }
      if (!selectable) continue;
      const bounds = row.container.getLocalBounds();
      row.container.hitArea = new Rectangle(
        bounds.x - 3,
        bounds.y - 3,
        bounds.width + 6,
        bounds.height + 6,
      );
      let pointer = this._battleTargets[count++];
      if (!pointer) {
        pointer = new Graphics().poly([0, 0, -3, -5, 3, -5]).fill(0xffdf80);
        pointer.eventMode = "none";
        this.layers.effects.addChild(pointer);
        this._battleTargets.push(pointer);
      }
      pointer.position.set(row.container.x, Math.max(6, row.container.y + bounds.y - 3));
      pointer.visible = true;
    }
    hideUnused(this._battleTargets, count);
  }

  render(game, data, battleData) {
    if (!this._ready) return;
    this.diagnostics.begin(game);
    this.frameActors = [];
    const start = performance.now();
    if (this._previousFrame && start > this._previousFrame) {
      this._frameIntervals.push(start - this._previousFrame);
      if (this._frameIntervals.length > 120) this._frameIntervals.shift();
    }
    this._previousFrame = start;
    this._visibleTiles = 0;
    this._visibleActors = 0;
    this.openingMarch.container.visible = false;
    const displayedBattle =
      this.heldBattle ||
      game?.battle ||
      (this._battleExit?.until > start / 1000 ? this._battleExit.battle : null);
    const inBattle = !!displayedBattle;
    this.fieldPresentation.prepare(game, inBattle);
    this._viewport(inBattle);
    this.layers.actors.visible = true;
    this.layers.mapLayers.visible = !inBattle;
    this.layers.near.visible = !inBattle;
    this._background.visible = false;
    this._battleBackground.visible = false;
    if (inBattle) {
      hideUnused(this._fieldSprites, 0);
      this._drawBattle({ battle: displayedBattle }, battleData);
    } else {
      this._battleSceneLayer.visible = false;
      if (this._battleSceneBattle) {
        this._battleSceneBattle = null;
        this.backgroundParticles.clear();
      }
      if (this.battlePresentation.battle) {
        this.battlePresentation.clear();
        this.particles.clear();
      }
      hideUnused(this._battleSprites, 0);
      hideUnused(this._battleNames, 0);
      hideUnused(this._battleTargets, 0);
      if (this.openingMarch.matches(game)) {
        hideUnused(this._fieldSprites, 0);
        this.layers.mapLayers.visible = this.layers.actors.visible = false;
        this.frameActors = this.openingMarch.draw(game, data, this.fieldPresentation.catalog);
        this._visibleActors = this.frameActors.filter((row) => row.drawn).length;
      } else {
        this._drawMap(game || {}, data);
        this.fieldPresentation.project(this.app.renderer, this.layers, game);
      }
    }
    this._fade.alpha = sceneFadeAlpha(game?.fade, game?.time || 0, inBattle);
    this._fade.visible = this._fade.alpha > 0;
    this._drawEffects(game);
    const particleDelta =
      this._previewClock == null
        ? Math.min(0.1, Math.max(0, (start - (this._particleTime || start)) / 1000))
        : 0;
    this.backgroundParticles.update(particleDelta);
    if (this._previewClock == null)
      this.particles.update(
        Math.min(0.1, Math.max(0, (start - (this._particleTime || start)) / 1000)),
      );
    if (this._previewClock != null) this.particles.update(0);
    this._particleTime = start;
    this.layers.effects.setChildIndex(this._fade, this.layers.effects.children.length - 1);
    this.layers.effects.setChildIndex(this._flashSprite, this.layers.effects.children.length - 1);
    this.app.render();
    const renderer = this.app.renderer;
    if (
      renderer.accessibility?.isActive &&
      renderer.backBuffer?.useBackBuffer &&
      !renderer.renderingToScreen &&
      renderer.renderTarget.renderTarget?.isRoot
    ) {
      // Pixi8.22 presents the back buffer to the canvas in renderEnd, but its
      // root-pass flag still describes the intermediate texture. Accessibility
      // then skips postrender. Rebind the already presented screen through the
      // public render-target API without clearing/drawing, and update its DOM.
      renderer.renderTarget.renderStart({ target: renderer.view.renderTarget, clear: false });
      renderer.accessibility.postrender();
      this._accessibilityScreenSyncs = (this._accessibilityScreenSyncs || 0) + 1;
    }
    this._renderedGame = game;
    this._renderedFrame = {
      mapId: game?.mapId ?? null,
      time: game?.time ?? null,
      inBattle,
      fieldFadeAlpha: this._fade.alpha,
      frame: this._frameCount,
    };
    const overlay = this.app.renderer.accessibility?.div;
    if (overlay) {
      const rect = this.canvas.getBoundingClientRect();
      // Position can change without a canvas resize (centered document layout).
      overlay.style.transform = `translate(${rect.left}px, ${rect.top}px) scale(${rect.width / (this._screenWidth || this._width)}, ${rect.height / (this._screenHeight || this._height)})`;
    }
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
      accessibilityScreenSyncs: this._accessibilityScreenSyncs || 0,
      renderMs: mean(this._renderTimes),
      renderMaxMs: Math.max(0, ...this._renderTimes),
      logicalWidth: this._width,
      logicalHeight: this._height,
      displayScale: this._displayScale || 1,
      resolution: this._resolution || 1,
      visibleTiles: this._visibleTiles,
      visibleActors: this._visibleActors,
      actorFrames: this.frameActors || [],
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
      retainedRenderPages: this._retainedRenderPages || 0,
      detachedTextureBindings: this._detachedTextureBindings || 0,
      atlasImages: this._atlasViews.size,
      warnings: [...this._warnings],
      particles: this.particles.metrics(),
      field: this.fieldPresentation.metrics(),
      waterLayers: this._tileLayers
        .filter((state) => state.container.visible && state.water)
        .map((state) => ({ ready: state.water.ready, warnings: [...state.water.warnings] })),
      backgroundParticles: this.backgroundParticles.metrics(),
    };
  }

  destroy() {
    this.battlePresentation.clear();
    this.particles.destroy();
    this.backgroundParticles.destroy();
    this.fieldPresentation.destroy();
    for (const state of this._tileLayers) state.water?.destroy();
    this._backgroundShader?.destroy();
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
