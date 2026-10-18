import { Container, Filter, GlProgram, Rectangle, RenderTexture, Sprite, Texture } from "pixi.js";
import { AirshipMotion, flightCamera, radians } from "./airship-motion.js";
import { BirdView } from "./bird-view.js";
import { PRFilter, materialFromLayer } from "./pr-filters.js";
import { screenEffectAmount, clearMapEffects } from "./field-screen-effects.js";

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vLocalCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  gl_Position = vec4(p.x * 2.0 / uOutputTexture.x - 1.0,
    p.y * 2.0 * uOutputTexture.z / uOutputTexture.y - uOutputTexture.z, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vLocalCoord = aPosition;
}`;
const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uTone;
uniform vec4 uEffects;
void main() {
  vec2 uv = vTextureCoord;
  if (uEffects.w > 0.0) uv.x += sin(uv.y * 48.0 + uEffects.x * 6.0) * 0.005 * uEffects.w;
  vec4 c = texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
  c.rgb = mix(c.rgb, vec3(dot(c.rgb, vec3(0.299,0.587,0.114))), uEffects.y);
  float luma = dot(c.rgb,vec3(.299,.587,.114));
  vec3 sepia = mix(vec3(.235294,.141177,.098039)*c.a,vec3(1.311606,1.119329,.817179)*c.a,luma);
  c.rgb = mix(c.rgb,sepia,uEffects.z);
  c.rgb = mix(c.rgb, uTone.rgb * c.a, uTone.a);
  finalColor = c;
}`;

function filter(name, code, uniforms) {
  return new Filter({
    glProgram: GlProgram.from({
      name,
      vertex: "#version 300 es\n" + vertex,
      fragment: "#version 300 es\n" + code,
      preferredFragmentPrecision: "highp",
    }),
    resources: { properties: { ...uniforms } },
    resolution: 1,
    antialias: false,
  });
}
function plane(label, parent) {
  const value = new Container({ label });
  parent.addChild(value);
  return value;
}
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const tint = (rgb) => ((rgb[0] * 255) << 16) | ((rgb[1] * 255) << 8) | (rgb[2] * 255);
function color(value, fallback) {
  if (!value) return fallback;
  const rgb = String(value).replace(/^#(?:[a-f\d]{2})?([a-f\d]{6})$/i, "$1");
  return [0, 2, 4].map((at) => Number.parseInt(rgb.slice(at, at + 2), 16) / 255).concat(1);
}

/** Scenery clocks and camera projection live here, outside saved game state. */
export class FieldPresentation {
  constructor({ layers, getTexture, warn, sampleActor, diagnostics }) {
    this.getTexture = getTexture;
    this.diagnostics = diagnostics;
    this.warn = warn;
    this.sampleActor = sampleActor;
    this.far = plane("pr-far-scenery", layers.far);
    this.backdropPlane = new Sprite(Texture.WHITE);
    this.backdropPlane.width = 320;
    this.backdropPlane.height = 180;
    this.backdropPlane.tint = 0x000000;
    this.far.addChild(this.backdropPlane);
    this.waterPlane = new Sprite(Texture.WHITE);
    this.waterPlane.width = 320;
    this.waterPlane.height = 180;
    this.waterPlane.tint = 0x225b9a;
    this.waterPlane.visible = false;
    this.far.addChild(this.waterPlane);
    this.waterFilter = new PRFilter("Last/WorldmapFarBgWarterSurfaceShader", {
      getTexture,
      width: 320,
      height: 180,
      warn: (message) => warn("water:" + message, message),
    });
    this.waterPlane.filters = [this.waterFilter];
    this.near = plane("pr-near-scenery", layers.near);
    this.near.filterArea = new Rectangle(0, 0, 320, 180);
    this.maskFilter = new PRFilter("Unlit/ForegroundAlphaMaskTransparentShader", {
      getTexture,
      width: 320,
      height: 180,
      warn: (message) => warn("foreground:" + message, message),
    });
    this.gps = plane("pr-gps", layers.effects);
    this.birdView = new BirdView({
      parent: layers.near,
      getTexture,
      warn,
      diagnostics,
      sampleActor,
    });
    this.projected = this.birdView.container;
    this.flightMotion = new AirshipMotion({ warn });
    this.screenFilter = filter("pr-field-screen-effects", fragment, {
      uTone: { value: new Float32Array([1, 1, 1, 0]), type: "vec4<f32>" },
      uEffects: { value: new Float32Array(4), type: "vec4<f32>" },
    });
    this.marker = new Sprite(Texture.WHITE);
    this.marker.tint = 0xffff70;
    this.marker.width = this.marker.height = 2;
    this.gps.addChild(this.marker);
    this.farPlanes = [];
    this.nearPlanes = [];
    this.gpsSprites = [];
    this.reset();
  }

  setCatalog(catalog) {
    this.catalog = catalog;
    for (const message of catalog.warnings || []) this.warn("field:" + message, message);
  }

  reset() {
    this.mapId = null;
    this.variant = null;
    this.farEnabled = true;
    this.nearEnabled = null;
    this.gray = 0;
    this.tone = null;
    this.screenEffects = {};
    this.water = {};
    this.view = null;
    this.clock = 0;
    this.flight = false;
    this.flightMotion.reset();
    this.heightTransition = null;
    this.landingVehicle = null;
    this._metrics = {};
    this._farKey = null;
    this.farTarget = this.previousFar = null;
    this.currentTone = null;
    this.backdrop = null;
  }

  event(event) {
    if (event.kind === "map") {
      // A source ChangeMap can reload the same map ID with a new camera.
      // Reset the view/effect lifetime even when its numeric ID is unchanged.
      this.mapId = null;
      this._syncMap(event.mapId);
      return;
    }
    if (event.kind === "airship-motion") {
      this._syncMap(event.mapId);
      this.flightMotion.start(event, this.catalog?.flight);
      return;
    }
    if (event.kind === "vehicle" && [4, 5].includes(event.id)) {
      this.heightTransition = { time: Number(event.time) || 0, from: 0, to: 1, duration: 1 };
      return;
    }
    if (event.kind === "vehicle-landing") {
      this.landingVehicle = event.id;
      this.heightTransition = { time: Number(event.time) || 0, from: 1, to: 0, duration: 1 };
      return;
    }
    if (event.kind !== "presentation-command") return;
    const { name, i = [], r = [], s = [] } = event;
    this._syncMap(event.mapId);
    const time = Number(event.time) || 0;
    if (name === "ColorFade")
      this.tone = {
        rgb: i.slice(0, 3).map((v) => v / 255),
        alpha: (i[3] ?? 0) / 255,
        from: this.currentTone || [1, 1, 1, 0],
        time,
        duration: Math.abs(r[0] || 0),
      };
    if (name === "BackdropColor") this.backdrop = tint(i.slice(0, 3).map((v) => v / 255));
    if (name === "ScreenEffect") {
      this.screenEffects[i[0]] = { value: i[1], time, duration: Math.abs(r[0] || 0) };
      this.warn(
        "field:screen-effect",
        "ScreenEffect preset1 uses a sepia approximation from the PR flashback context and shader colors, preset3 a horizontal wave. Native preset property bindings, centers and exact easing remain inferred; no mosaic property exists in the source screen shader.",
      );
    }
    if (name === "ChangeView") {
      this.view = Boolean(i[0]);
      // The source blend duration controls the same independent pitch clock.
      this.heightTransition = {
        time,
        from: i[0] ? 0 : 1,
        to: i[0] ? 1 : 0,
        duration: Math.abs(r[0] || 0.016),
      };
    }
    if (name === "Water") {
      const layer = i[0] ?? -1;
      this.water[`${layer}:${s[0]}`] = {
        name: s[0],
        layer,
        from: r[0],
        to: r[1],
        duration: r[2],
        time,
        order: (this.waterOrder = (this.waterOrder || 0) + 1),
      };
    }
    if (name !== "SysCall") return;
    const selector = s[0] || "";
    if (
      /乗り物に乗る：(?:ブラックジャック|ファルコン)/.test(selector) &&
      /アニメ・BGMなし/.test(selector)
    ) {
      this.heightTransition = null;
      this.landingVehicle = null;
    }
    if (/モノクロフィルター/.test(selector)) this.gray = selector.includes("はずす") ? 0 : 1;
    if (/幻獣界フィルター/.test(selector)) this.gray = selector.includes("はずす") ? 0 : 0.35;
    if (/飛空艇（通常）|通常を表示/.test(selector)) {
      this.variant = 0;
      this.farEnabled = true;
    }
    if (/飛空艇（特殊）|明るい1/.test(selector)) {
      this.variant = 1;
      this.farEnabled = true;
    }
    if (/飛空艇（黒）/.test(selector)) {
      this.variant = 2;
      this.farEnabled = true;
    }
    const numbered = selector.match(/遠景([１２３４])/);
    if (numbered && /のみ表示/.test(selector)) {
      this.variant = "１２３４".indexOf(numbered[1]);
      this.farEnabled = true;
    }
    if (/背景.*消去|遠景.*フェードアウト|背景.*フェードアウト|背景.*FO/.test(selector))
      this.farEnabled = false;
    if (/背景.*フェードイン|背景.*表示/.test(selector)) this.farEnabled = true;
    if (/近景.*消去/.test(selector)) this.nearEnabled = false;
    if (/近景.*表示/.test(selector)) this.nearEnabled = true;
    if (/スクロール/.test(selector)) this.scroll = true;
  }

  _syncMap(id) {
    const oldTone = this.mapId !== id && this.tone;
    if (!clearMapEffects(this, id)) return;
    if (oldTone)
      this.warn?.(
        "field:camera-tone-lifecycle",
        "ColorFade is treated as a field-camera overlay, reset on map-camera replacement and excluded from combat. Exact native carry-over and interpolation remain inferred; the prior implementation retained opaque black/white overlays across unrelated maps.",
      );
    this.variant = null;
    this.farEnabled = true;
    this.nearEnabled = null;
    this.view = null;
    this.scroll = false;
    this.flightMotion.reset();
    this.heightTransition = null;
    this.landingVehicle = null;
    this._farKey = null;
    this.farTarget = this.previousFar = null;
  }

  actorBlendMode(asset, character) {
    const shaderType = Number(
      character?.animation?.data?.shader_type ??
        this.catalog?.actorMaterials?.[asset]?.shaderType ??
        0,
    );
    if (shaderType === 1) {
      this.warn(
        "field:actor-shader-type-1",
        "PR field anim_info shader_type=1 is interpreted as additive blending: its three source waterfall/effect assets have opaque black backing. The enum-to-material binding is inferred; original RGB/alpha pixels remain unchanged.",
      );
      return "add";
    }
    if (shaderType !== 0)
      this.warn(
        `field:actor-shader-type-${shaderType}`,
        `Unknown PR field anim_info shader_type=${shaderType} for ${asset}; using normal blending.`,
      );
    return "normal";
  }

  prepare(game, inBattle) {
    this.flightFrames = [];
    if (game?.map) this._syncMap(game.mapId);
    this.clock = game?.time || 0;
    const transition = this.heightTransition;
    const leavingView =
      this.view === false &&
      transition?.to === 0 &&
      this.clock < transition.time + transition.duration;
    this.flight =
      !inBattle &&
      (leavingView ||
        (this.view ??
          (/^Map_100(?:10|20|30)/i.test(game?.map?.name || "") &&
            ([4, 5].includes(Number(game?.player?.vehicle)) || !!this.landingVehicle))));
    if (!this.flight) this._metrics.flightState = null;
    this.flightState = this.flightMotion.sample(game);
    this.flightHeight = transition
      ? lerp(
          transition.from,
          transition.to,
          transition.duration ? (this.clock - transition.time) / transition.duration : 1,
        )
      : 1;
    const camera = flightCamera(this.flightState, this.catalog?.flight, this.flightHeight),
      distance = camera.distance,
      pitch = radians(camera.pitch),
      coverage = Math.max(
        1,
        (2 *
          Math.hypot(Math.cos(pitch) * distance + 360, Math.sin(pitch) * distance + camera.upDown) *
          Math.tan(radians(camera.fov) / 2)) /
          640,
      );
    // PR changes discrete RT tiers; continuous overscan keeps the same native
    // camera rays without exposing a clamped texture edge during a turn.
    const tier = Math.ceil(coverage * 2) / 2;
    this.flightSize = {
      width: 640 * tier,
      height: 360 * tier,
    };
    this.far.visible = this.near.visible = this.projected.visible = !inBattle && !!game?.map;
    this.gps.visible = !inBattle && /^Map_100(?:10|20|30)/i.test(game?.map?.name || "");
    this.projected.visible &&= this.flight;
    const tone = this.tone;
    this.currentTone = tone
      ? [...tone.rgb, tone.alpha].map((v, n) =>
          lerp(tone.from[n], v, tone.duration ? (this.clock - tone.time) / tone.duration : 1),
        )
      : [1, 1, 1, 0];
    // ColorFade belongs to the field camera; battle events often begin after
    // fading that camera to black. Keep its state for the return to the map.
    this.screenFilter.resources.properties.uniforms.uTone = inBattle
      ? [1, 1, 1, 0]
      : this.currentTone;
    this.screenFilter.resources.properties.uniforms.uEffects = [
      this.clock,
      this.gray,
      screenEffectAmount(this.screenEffects[1], this.clock),
      screenEffectAmount(this.screenEffects[3], this.clock),
    ];
    return this.flight ? 640 : 320;
  }

  _sprites(pool, parent, images, offset, kind) {
    let count = 0;
    for (const row of images) {
      const texture = this.getTexture(row.image?.url, {
        required: true,
        entityId: `scene:${kind}:${row.name || count}`,
        animation: kind,
      });
      if (!texture) continue;
      const p = row.properties || {};
      const w = row.image.width,
        h = row.image.height;
      const scrollX = p.h_manual_scroll ? offset.x * Number(p.h_manual_speed_scale ?? 1) : 0;
      const scrollY = p.v_manual_scroll ? offset.y * Number(p.v_manual_speed_scale ?? 1) : 0;
      const autoX = p.auto_scroll || this.scroll ? this.clock * Number(p.h_speed || 0) : 0;
      const autoY = p.auto_scroll || this.scroll ? this.clock * Number(p.v_speed || 0) : 0;
      const x = ((((row.x || 0) - scrollX - autoX) % w) + w) % w;
      const y = ((((row.y || 0) - scrollY - autoY) % h) + h) % h;
      for (let repeat = -1; repeat < Math.ceil(320 / w); repeat++) {
        for (let ry = -1; ry < Math.ceil(180 / h); ry++) {
          const sprite = (pool[count] ||= parent.addChild(
            new Sprite({ texture, roundPixels: true }),
          ));
          sprite.texture = texture;
          sprite.scale.set(1);
          sprite.position.set(Math.round(x + repeat * w), Math.round(y + ry * h));
          sprite.alpha = row.alpha * (row.opacity ?? 1);
          sprite.blendMode =
            p.blend_type === 2 ? "multiply" : p.blend_type === 1 ? "add" : "normal";
          sprite.visible = true;
          count++;
        }
      }
    }
    for (let n = count; n < pool.length; n++) pool[n].visible = false;
    return count;
  }

  draw(game, offset = { x: 0, y: 0 }, data) {
    this.flightFrames = [];
    this._data = data;
    if (!this.catalog || !game.map) return;
    const binding = this.catalog.maps[game.mapId] || { far: [], near: [] };
    this.backdropPlane.tint = this.backdrop ?? tint(color(binding.backdrop, [0, 0, 0, 1]));
    const name = game.map.name;
    const water = binding.far.find((row) =>
      /Warter|Water|Ocean/.test(row.properties?.opaque_shader),
    );
    this.waterPlane.visible = !!water;
    if (this.waterPlane.visible) {
      this.waterPlane.tint = 0xffffff;
      const sea = water.textures[0] || water.image;
      const texture = this.getTexture(sea?.url, {
        required: true,
        entityId: "scene:water",
        animation: water.name,
      });
      // A map/atlas reload can invalidate the previous view while this page is
      // still loading. Never leave that destroyed texture on a visible plane.
      this.waterPlane.texture = texture || Texture.EMPTY;
      this.waterPlane.visible = !!texture;
      this.waterPlane.width = 320;
      this.waterPlane.height = 180;
      if (this._waterLayer !== water) {
        this._waterLayer = water;
        this.waterFilter.setMaterial(
          materialFromLayer("Last/WorldmapFarBgWarterSurfaceShader", water.properties, {
            _MainTex: sea,
            _NoiseTex: water.textures[2],
          }),
        );
      }
      this.waterFilter.update(this.clock, { width: 320, height: 180 });
    }
    this._flightWater = !!water && this.waterPlane.visible;
    this.waterPlane.visible &&= !this.flight;
    const chosen = this.farEnabled
      ? binding.far.filter(
          (row) =>
            row !== water &&
            (this.variant === null
              ? row.visible !== false && row.properties.active !== false
              : row.name.endsWith(String(this.variant + 1))),
        )
      : [];
    let key = `${game.mapId}:${this.variant}:${this.farEnabled}`;
    if (this._farKey !== key) {
      this.previousFar = this.farTarget;
      this.farTarget = chosen;
      this.farChanged = this.clock;
      this._farKey = key;
    }
    // A new map has no previous scenery to crossfade from. Its field-camera
    // FadeIn already controls entry visibility; a second clock at zero would
    // keep restored/paused scenes black forever until game time advances.
    const t = this.previousFar ? Math.min(1, Math.max(0, (this.clock - this.farChanged) / 0.7)) : 1;
    const images = [];
    if (this.previousFar && t < 1)
      images.push(...this.previousFar.map((row) => ({ ...row, alpha: 1 - t })));
    if (this.farTarget) images.push(...this.farTarget.map((row) => ({ ...row, alpha: t })));
    this._metrics.farSprites = this._sprites(this.farPlanes, this.far, images, offset, "far");
    this._metrics.nearSprites = this._sprites(
      this.nearPlanes,
      this.near,
      this.nearEnabled === false
        ? []
        : binding.near
            .filter((row) => row.visible && (this.nearEnabled || row.properties.active !== false))
            .map((row) => ({ ...row, alpha: 1 })),
      offset,
      "near",
    );
    const masked =
      this.nearEnabled !== false &&
      binding.near.find(
        (row) => row.mask && row.visible && (this.nearEnabled || row.properties.active !== false),
      );
    this.near.filters = masked ? [this.maskFilter] : null;
    if (masked) {
      if (this._maskLayer !== masked) {
        this._maskLayer = masked;
        this.maskFilter.setMaterial({ textures: { _MaskTex: masked.mask } });
        this.warn(
          "field:mask-anchor",
          "PR foreground masks use source alpha (their RGB is black), with opaque outside the mask rectangle. The hole follows the player's field-pixel center; native serialOffset centering is approximated.",
        );
      }
      const tile = game.map.tileSize || 16;
      const px = (game.player.x + 0.5) * tile - offset.x;
      const py = game.player.y * tile - offset.y;
      this.maskFilter.update(this.clock, {
        width: 320,
        height: 180,
        maskAlphaOnly: true,
        maskOutsideOpaque: true,
        maskTransform: [
          320 / masked.mask.width,
          180 / masked.mask.height,
          (160 - px) / masked.mask.width,
          (90 - py) / masked.mask.height,
        ],
      });
    }
    const gps = this.catalog.gps[game.gpsId] || this.catalog.gps[/10020/.test(name) ? 2 : 1];
    let count = 0;
    if (this.gps.visible && gps) {
      for (const row of [gps.screen, gps.overlay]) {
        const texture = row && this.getTexture(row.url, { required: true, entityId: "scene:gps" });
        if (!texture) continue;
        const sprite = (this.gpsSprites[count] ||= this.gps.addChildAt(new Sprite(texture), count));
        sprite.texture = texture;
        sprite.position.set(261, 121);
        sprite.width = sprite.height = 56;
        sprite.alpha = 0.85;
        sprite.visible = true;
        count++;
      }
      const x = ((game.player.x % gps.width) + gps.width) % gps.width;
      const y = ((game.player.y % gps.height) + gps.height) % gps.height;
      this.marker.position.set(
        261 + Math.round((x / gps.width) * 56),
        121 + Math.round((y / gps.height) * 56),
      );
      this.marker.alpha = Math.floor(this.clock * 3) % 2 ? 1 : 0.35;
    }
    for (let n = count; n < this.gpsSprites.length; n++) this.gpsSprites[n].visible = false;
    this._metrics = {
      ...this._metrics,
      mapId: game.mapId,
      flight: this.flight,
      gpsId: gps && this.gps.visible ? game.gpsId || (/10020/.test(name) ? 2 : 1) : null,
      crossfade: t,
      foregroundMask: masked ? masked.mask.name : null,
    };
  }

  project(renderer, layers, game) {
    if (!this.flight) return;
    const { width, height } = this.flightSize;
    if (
      !this.planeTexture ||
      this.planeTexture.width !== width ||
      this.planeTexture.height !== height
    ) {
      this.planeTexture?.destroy(true);
      this.planeTexture = RenderTexture.create({
        width,
        height,
        resolution: 1,
        scaleMode: "nearest",
      });
    }
    const previous = layers.mapLayers.filterArea;
    layers.mapLayers.filters = null;
    layers.mapLayers.filterArea = new Rectangle(0, 0, width, height);
    if (this._flightWater) {
      this.waterPlane.visible = true;
      this.waterPlane.width = width;
      this.waterPlane.height = height;
      this.waterFilter.update(this.clock, { width, height });
      renderer.render({ container: this.waterPlane, target: this.planeTexture, clear: true });
      this.waterPlane.visible = false;
      this.waterPlane.width = 320;
      this.waterPlane.height = 180;
    }
    renderer.render({
      container: layers.mapLayers,
      target: this.planeTexture,
      clear: !this._flightWater,
    });
    renderer.render({ container: layers.actors, target: this.planeTexture, clear: false });
    layers.mapLayers.filterArea = previous;
    layers.mapLayers.visible = layers.actors.visible = false;
    this.flightFrames = this.birdView.draw(
      renderer,
      this.planeTexture,
      game,
      this._data,
      this.catalog,
      this.flightState,
      this.flightHeight,
      this.landingVehicle,
    );
    this._metrics.flightState = this.birdView.metrics;
  }

  focus(game) {
    const focus = game.camera?.manual ? game.camera : game.player;
    return this.flight
      ? { x: focus.x + this.flightState.offset.x, y: focus.y + this.flightState.offset.y }
      : focus;
  }

  metrics() {
    return this._metrics;
  }

  destroy() {
    this.screenFilter.destroy();
    this.birdView.destroy();
    this.waterFilter.destroy();
    this.maskFilter.destroy();
    this.planeTexture?.destroy(true);
    for (const container of [this.far, this.near, this.gps]) container.destroy({ children: true });
  }
}
