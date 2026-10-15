import { minimapMarkers, MINIMAP_ROTATION } from "/runtime/core/minimap.js";
import { projectFlatWorldAutoPose } from '/runtime/core/field-world-auto-tasks.js';
import { FIELD_POSE as FACING } from "/runtime/core/actor-animation.js";
import { fieldFadeOverlay } from "/runtime/core/field-fade.js";
import { projectFieldBackground } from "/runtime/core/field-background.js";
import { assertFieldCompositionRenderTargets, composeFieldNativePixels,
  fieldCompositionActorDepth, fieldCompositionTileDepth, fieldCompositionActorTextures,
  validateFieldNativeComposition, prepareFieldCompositionTargets,
  scaleFieldCompositionPixels } from "/runtime/core/field-native-composition.js";
import { projectFieldActorView, validateFieldActorViewProjection } from "/runtime/core/field-actor-view.js";
import { canonical } from "/runtime/core/canonical.js";
import { canonicalCell, validateFieldMapTopology } from "/runtime/core/field-map-topology.js";
import { validateFieldEffectBoardMaterial } from "/runtime/core/field-particle-geometry.js";
import { prepareSourceFieldEffectBoards } from "./field-effect-renderer.js";
import { WEB_LOGICAL_FIELD_EFFECTS } from "/runtime/core/field-logical-effects.js";
import { drawStoryTimer } from "./story-overlay.js";
export class Renderer {
  effectsDeferred(game) {
    return game.fieldEffectsDisplayPolicy === WEB_LOGICAL_FIELD_EFFECTS &&
      this.content.developmentProfile?.logicalFieldEffects === WEB_LOGICAL_FIELD_EFFECTS &&
      this.content.fieldEffects?.webPolicy?.kind === WEB_LOGICAL_FIELD_EFFECTS;
  }
  constructor(canvas, content, images, effectProvider = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.content = content;
    this.images = images;
    this.nativePixels = new WeakMap();
    this.presentationOmissions = [];
    // Explicit qualified RT and draw-order provider. Absence is a capability
    // error for an effect scene, never an empty or synthetic particle frame.
    this.effectProvider = effectProvider;
    this.sets = [...content.map.tilesets].sort(
      (a, b) => b.firstgid - a.firstgid,
    );
  }
  tile(raw, x, y, time, resolved) {
    const gid = (resolved ?? raw) & 0x0fffffff;
    if (!gid) return;
    const s = this.sets.find((s) => s.firstgid <= gid);
    if (!s) throw new Error("图块缺少图集");
    const image = this.images.get(this.content.map.textures[s.image]);
    if (!image) throw new Error("缺少地图图片 " + s.image);
    let n = gid - s.firstgid,
      animation = s.tiles?.find((t) => t.id === n)?.animation;
    if (resolved === undefined && animation?.length) {
      let t = time % animation.reduce((sum, f) => sum + f.duration, 0);
      for (const f of animation) {
        n = f.tileid;
        if (t < f.duration) break;
        t -= f.duration;
      }
    }
    const sx =
        (n % s.columns) * (s.tilewidth + (s.spacing ?? 0)) + (s.margin ?? 0),
      sy =
        Math.floor(n / s.columns) * (s.tileheight + (s.spacing ?? 0)) +
        (s.margin ?? 0);
    const c = this.ctx,
      h = !!(raw & 0x80000000),
      v = !!(raw & 0x40000000),
      d = !!(raw & 0x20000000);
    c.save();
    c.translate(x + s.tilewidth / 2, y + s.tileheight / 2);
    if (d) c.transform(0, v ? -1 : 1, h ? -1 : 1, 0, 0, 0);
    else c.scale(h ? -1 : 1, v ? -1 : 1);
    c.drawImage(
      image,
      sx,
      sy,
      s.tilewidth,
      s.tileheight,
      -s.tilewidth / 2,
      -s.tileheight / 2,
      s.tilewidth,
      s.tileheight,
    );
    c.restore();
  }
  actorElevation(game, actor) {
    if (typeof game?.birdViewActorElevation === "function") return game.birdViewActorElevation(actor.id);
    if (actor.birdView !== undefined) throw new Error("角色高度缺少已授权的实际游戏所有者");
    return 0;
  }
  point(a) {
    const m = a.motion;
    if (!m) return a;
    const t = Math.min(1, m.elapsed / m.duration);
    return {
      x: m.from.x + (m.to.x - m.from.x) * t,
      y: m.from.y + (m.to.y - m.from.y) * t,
    };
  }
  topology(game) {
    const m = this.content.map, topology = m.topology, host = this.content.cameraHost;
    if (topology === undefined) {
      if (host?.loop.horizontal || host?.loop.vertical)
        throw new Error("循环相机缺少地图拓扑");
      return null;
    }
    validateFieldMapTopology(topology);
    const { range, loop } = topology;
    if (range.x + range.width > m.width || range.y + range.height > m.height ||
        canonical(range) !== canonical(game.collisionRange))
      throw new Error("地图拓扑与地图范围不符");
    if (host && (canonical(host.mapRange) !== canonical(range) || canonical(host.loop) !== canonical(loop)))
      throw new Error("循环相机与地图拓扑不符");
    return loop.horizontal || loop.vertical ? topology : null;
  }
  /** Sampling uses canonical source cells; screen positions use continuous
   * images. Both Canvas lanes consume the same ordered visible tile set. */
  *tileCells(layer, cx, cy, width, height, topology, crop = null) {
    const range = topology?.range ?? crop ?? { x: 0, y: 0, width: layer.width, height: layer.height };
    if (topology && (range.x + range.width > layer.width || range.y + range.height > layer.height))
      throw new Error("循环图层未覆盖地图范围");
    const x0 = Math.floor(cx / 16), y0 = Math.floor(cy / 16),
      x1 = Math.ceil((cx + width) / 16), y1 = Math.ceil((cy + height) / 16),
      left = topology?.loop.horizontal ? x0 : Math.max(range.x, 0, x0),
      right = topology?.loop.horizontal ? x1 : Math.min(range.x + range.width, layer.width, x1),
      top = topology?.loop.vertical ? y0 : Math.max(range.y, 0, y0),
      bottom = topology?.loop.vertical ? y1 : Math.min(range.y + range.height, layer.height, y1);
    if (![left, right, top, bottom].every(Number.isSafeInteger)) throw new Error("地图视口超出可投影范围");
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const source = topology ? canonicalCell(topology, { x, y }) : { x, y };
      yield { x, y, index: source.y * layer.width + source.x };
    }
  }
  /** All visible periodic images, including viewports wider than one period.
   * These offsets are transient draw data, never additional actor owners. */
  periodicOffsets(rect, width, height, topology) {
    if (!topology) return [{ x: 0, y: 0 }];
    const axis = (start, size, viewport, period, loop) => {
      if (!loop) return [0];
      const first = Math.floor(-(start + size) / period) + 1,
        last = Math.ceil((viewport - start) / period) - 1;
      if (![first, last].every(Number.isSafeInteger)) throw new Error("演员周期副本超出可投影范围");
      return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => (first + i) * period);
    };
    const xs = axis(rect.x, rect.width, width, topology.range.width * 16, topology.loop.horizontal),
      ys = axis(rect.y, rect.height, height, topology.range.height * 16, topology.loop.vertical);
    return ys.flatMap((y) => xs.map((x) => ({ x, y })));
  }
  compositionCanvas(width, height) {
    const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height)
      : this.canvas.ownerDocument?.createElement("canvas");
    if (!canvas) throw new Error("原生材质合成缺少离屏 Canvas");
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  compositionPixels(file) {
    const image = this.images.get(file);
    if (!image) throw new Error("原生合成缺少图像 " + file);
    let pixels = this.nativePixels.get(image);
    if (!pixels) {
      const width = image.naturalWidth ?? image.width, height = image.naturalHeight ?? image.height;
      const canvas = this.compositionCanvas(width, height), context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      pixels = { width, height, data: context.getImageData(0, 0, width, height).data };
      this.nativePixels.set(image, pixels);
    }
    return pixels;
  }
  /** Explicit flat source display uses the selected package policy and actual
   * current actor frames. The policy preserves its native presentation gaps. */
  prepareFrameworkFlatComposition(game, actors, sourceCamera, cx, cy, width, height, topology) {
    const m = this.content.map, definition = m.nativeComposition;
    if (definition?.view.kind !== "framework-flat-field-view-v1") return null;
    const policy = definition.view.policy;
    if (policy === "framework-world-map-flat-v1"
      ? this.content.developmentProfile?.worldMap !== policy || this.content.entry.viewPlan?.isWorld !== true
      : policy !== "framework-ordinary-field-flat-v1" ||
        this.content.developmentProfile?.fieldPresentation !== policy || this.content.entry.viewPlan?.isWorld !== false)
      throw new Error(policy === "framework-world-map-flat-v1"
        ? "平面世界展示缺少明确的框架策略" : "二维展示缺少与当前地图一致的框架策略");
    validateFieldNativeComposition(definition);
    assertFieldCompositionRenderTargets(definition);
    if (!sourceCamera || !this.content.cameraHost || game.fieldEffectsSnapshot != null && !this.effectsDeferred(game))
      throw new Error("平面世界展示缺少相机或包含未支持特效");
    const view = definition.view, range = this.content.cameraHost.mapRange;
    if (view.mapSize.width !== range.width || view.mapSize.height !== range.height)
      throw new Error("平面世界展示范围不符");
    const projected = [], backgrounds = [];
    for (const background of view.backgrounds) {
      const t = background.texture, image = this.images.get(t.url);
      if (m.textures[t.key] !== t.url || !image ||
          (image.naturalWidth ?? image.width) !== t.width || (image.naturalHeight ?? image.height) !== t.height)
        throw new Error("平面世界背景缺少绑定的来源纹理");
      backgrounds.push({ image, width: t.width, height: t.height });
    }
    for (const layer of m.layers) if (!definition.layers.includes(layer.name) || layer.opacity !== 1)
      throw new Error("平面世界包含未绑定图层");
    for (const actor of actors) {
      if (!actor.native) throw new Error("平面世界混入未绑定演员");
      const entity = actor.native.entity, frame = actor.animation?.frame();
      if (!frame || actor.asset === null) continue;
      const mapAnimation = actor.native.mapAnimation;
      if (mapAnimation) {
        if (this.content.developmentProfile?.mapAnimatedEntities !== "web-field-animated-map-entities-v1" ||
            actor.native.scope?.kind !== "map-animated" || entity.character || entity.riding ||
            !Object.values(m.groups ?? {}).some(group => group.entities.some(source => source.id === actor.id &&
              source.kind === 10 && canonical(source.mapAnimation) === canonical(mapAnimation))) ||
            !Number.isFinite(entity.fadeAlpha) || entity.fadeAlpha < 0 || entity.fadeAlpha > 1 ||
            Math.fround(entity.fadeAlpha) !== entity.fadeAlpha)
          throw new Error("地图动画实体缺少当前来源与明确Web显示策略");
        if (!this.presentationOmissions.some(entry => entry.kind === "web-animated-map-entity" && entry.actorId === actor.id))
          this.presentationOmissions.push({ kind: "web-animated-map-entity", actorId: actor.id,
            policy: "web-field-animated-map-entities-v1", nativeParity: false,
            omitted: ["native-building-shader", "source-stencil", "native-front-depth"],
            initialFrame: "first-Default-frame-when-not-playing",
            opacity: "frame-alpha-times-material-alpha-squared-Web-policy" });
      } else {
      if (!entity.character || entity.riding || !entity.bodyOpaque ||
          !Number.isFinite(entity.fadeAlpha) || entity.fadeAlpha < 0 || entity.fadeAlpha > 1 || Math.fround(entity.fadeAlpha) !== entity.fadeAlpha)
        throw new Error("平面世界当前仅支持普通步行演员");
      validateFieldActorViewProjection(entity.viewBinding?.properties, definition.contextId, entity.layer);
      if (canonical(entity.viewBinding.properties) !== canonical(projectFieldActorView(view, entity.layer)))
        throw new Error("平面世界演员材质属于其他地图");
      const expected = fieldCompositionActorTextures(definition, entity.layer);
      if (canonical(expected) !== canonical(entity.transparentTextures))
        throw new Error("平面世界演员纹理绑定属于其他地图");
      }
      const sprite = this.content.characters[actor.asset]?.sprites[frame.sprite], image = sprite && this.images.get(sprite.file);
      if (!sprite || !image || (image.naturalWidth ?? image.width) !== sprite.width ||
          (image.naturalHeight ?? image.height) !== sprite.height) throw new Error("平面世界角色帧缺少来源图像");
      const point = this.point(actor), x = (point.x + 0.5) * 16 - cx + frame.x,
        y = (point.y + 0.5) * 16 - cy - frame.y - this.actorElevation(game, actor) + (mapAnimation ? mapAnimation.geometry.height * 0.5 : 0),
        rect = { x: x - sprite.width * (frame.flip ? 1 - sprite.pivot[0] : sprite.pivot[0]),
          y: y - sprite.height * (1 - sprite.pivot[1]), width: sprite.width, height: sprite.height };
      for (const offset of this.periodicOffsets(rect, width, height, topology)) projected.push({
        actor, frame, sprite, image, x: x + offset.x, y: y + offset.y,
        row: mapAnimation?.front ? Number.MAX_SAFE_INTEGER + mapAnimation.zOffset : point.y + offset.y / 16,
      });
    }
    projected.sort((a, b) => a.row - b.row || a.actor.id.localeCompare(b.actor.id));
    const canvas = this.compositionCanvas(width, height), context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = false; context.fillStyle = "#09111b"; context.fillRect(0, 0, width, height);
    for (const background of backgrounds) {
      // Screen-fixed source texture repetition is an explicit authored policy.
      for (let y = 0; y < height; y += background.height) for (let x = 0; x < width; x += background.width)
        context.drawImage(background.image, x, y);
    }
    const prior = this.ctx;
    try {
      this.ctx = context;
      for (const [li, layer] of m.layers.entries()) {
        this.layer(layer, cx, cy, width, height, game, li, topology);
        const index = ["BottomLayer", "GroundLayer", "UpperLayer", "CeilLayer"].indexOf(layer.name);
        for (const p of projected) if (p.actor.layer === index) {
          context.save(); context.translate(p.x, p.y); context.scale(p.frame.flip ? -1 : 1, 1);
          // The existing flat-field policy uses Canvas blending. Preserve the
          // bound ordinary shader's two material-alpha inputs in its opacity;
          // this remains Web flat presentation, not native pass equivalence.
          const materialAlpha = p.actor.native.entity.fadeAlpha;
          context.globalAlpha = Math.fround(Math.fround(p.frame.alpha * materialAlpha) * materialAlpha);
          context.drawImage(p.image, 0, 0, p.sprite.width, p.sprite.height,
            -p.sprite.width * p.sprite.pivot[0], -p.sprite.height * (1 - p.sprite.pivot[1]), p.sprite.width, p.sprite.height);
          context.restore();
        }
      }
    } finally { this.ctx = prior; }
    for (const kind of view.omissions) if (!this.presentationOmissions.some((entry) => entry.kind === kind))
      this.presentationOmissions.push({ kind, policy: view.policy });
    return context.getImageData(0, 0, width, height);
  }
  /** Native material preparation is complete before drawing to the visible
   * Canvas. Render targets are transient pixels; the existing actors remain
   * the only state owner. Legacy/development actors retain their old lane. */
  prepareNativeComposition(game, actors, sourceCamera, cx, cy, width, height, topology) {
    const m = this.content.map, definition = m.nativeComposition;
    if (!definition || !Object.values(game.actors).some((actor) => actor.native)) return null;
    if (definition.view.kind !== "native-default-field-view-v1")
      throw new Error("普通来源材质不能使用框架平面世界视图");
    validateFieldNativeComposition(definition);
    assertFieldCompositionRenderTargets(definition);
    const host = this.content.cameraHost;
    if (!sourceCamera || !host)
      throw new Error("原生普通材质缺少相机投影");
    const range = host.mapRange, tiles = [], projectedActors = [], omissions = [];
    if (definition.view.mapSize.width !== range.width || definition.view.mapSize.height !== range.height)
      throw new Error("原生材质地图范围与来源不符");
    for (const [li, layer] of m.layers.entries()) {
      if (!definition.layers.includes(layer.name) || layer.opacity !== 1)
        throw new Error("未绑定的原生图层材质");
      for (const { x, y, index } of this.tileCells(layer, cx, cy, width, height, topology, range)) {
        const raw = layer.data[index] >>> 0;
        const gid = (game.tileAnimations.tile(li, index) ?? raw) & 0x0fffffff;
        if (!gid) continue;
        const set = this.sets.find((s) => s.firstgid <= gid);
        if (!set || set.tilewidth !== 16 || set.tileheight !== 16) throw new Error("未恢复的原生图块尺寸");
        const n = gid - set.firstgid, image = this.compositionPixels(m.textures[set.image]);
        tiles.push({ image, layer: layer.name, source: { x: (n % set.columns) * (16 + (set.spacing ?? 0)) + (set.margin ?? 0),
          y: Math.floor(n / set.columns) * (16 + (set.spacing ?? 0)) + (set.margin ?? 0), width: 16, height: 16 },
          destination: { x: x * 16 - cx, y: y * 16 - cy, width: 16, height: 16 },
          flipX: !!(raw & 0x80000000), flipY: !!(raw & 0x40000000), diagonal: !!(raw & 0x20000000),
          depth: fieldCompositionTileDepth({ layer: layer.name, localRow: y - range.y,
            mapHeight: range.height, cameraY: sourceCamera.cameraPosition.y }) });
      }
    }
    const targets = definition.renderHost ? prepareFieldCompositionTargets(definition, { width, height, tiles })
      : { upper: null, ceil: null };
    const sampleTarget = (name) => name === null ? null : name === definition.upperTexture ? targets.upper
      : name === definition.ceilTexture ? targets.ceil : (() => { throw new Error("未绑定的原生预渲染纹理"); })();
    for (const actor of actors) {
      if (!actor.native) throw new Error("原生材质视口混入未绑定演员");
      const entity = actor.native.entity, frame = actor.animation?.frame();
      if (!frame || actor.asset === null) continue;
      if (!entity.character || entity.riding && (game.transportationPresentation !== "framework-development" || entity.fadeAlpha !== 1) ||
          !entity.bodyOpaque || !Number.isFinite(entity.fadeAlpha) || entity.fadeAlpha < 0 || entity.fadeAlpha > 1 ||
          Math.fround(entity.fadeAlpha) !== entity.fadeAlpha)
        throw new Error("原生普通材质不支持当前骑乘或透明提供器");
      if (entity.shadowVisible) omissions.push({ kind: "native-character-shadow", actorId: actor.id });
      if (!entity.viewBinding?.properties) throw new Error("原生演员缺少普通材质绑定");
      validateFieldActorViewProjection(entity.viewBinding.properties, definition.contextId, entity.layer);
      if (canonical(entity.viewBinding.properties) !== canonical(projectFieldActorView(definition.view, entity.layer)))
        throw new Error("原生演员材质参数未绑定当前地图完整来源");
      const textures = fieldCompositionActorTextures(definition, entity.layer);
      if (entity.transparentTextures.first !== textures.first || entity.transparentTextures.second !== textures.second)
        throw new Error("原生演员的上层纹理属于其他地图或层");
      const point = this.point(actor);
      const layers = [{ asset: actor.mount ?? actor.asset, frame, crop: 0, lift: 0 }];
      if (entity.riding) {
        if (!actor.mount || !actor.direction) throw new Error("框架骑乘缺少内外层资产或朝向");
        const key = FACING[actor.direction], riderKey = { WalkL: "RideL", WalkR: "RideR" }[key] ?? key;
        const animation = this.content.characters[actor.asset]?.animations[riderKey];
        const playback = actor.animation.snapshot();
        if (!animation?.frames.length || !playback) throw new Error("框架骑乘缺少骑手姿态");
        // Explicit framework convention: derive the rider from the existing
        // outer clock, never create another native playback owner in Canvas.
        const phase = Math.max(0, Math.min(1, playback.elapsed / playback.duration));
        const rider = animation.frames[Math.min(animation.frames.length - 1, Math.floor(phase * animation.frames.length))];
        layers.push({ asset: actor.asset, frame: { ...rider, flip: animation.flip !== rider.flip }, crop: 8, lift: 14 });
        omissions.push({ kind: "framework-rider-pose-crop-offset", actorId: actor.id });
      }
      for (const layer of layers) {
        const pose = layer.frame, sprite = this.content.characters[layer.asset]?.sprites[pose.sprite];
        if (!sprite || sprite.height <= layer.crop) throw new Error("原生角色帧缺少来源图像");
        const image = this.compositionPixels(sprite.file);
        if (image.width !== sprite.width || image.height !== sprite.height) throw new Error("原生角色图像几何不符");
        const x = (point.x + 0.5) * 16 - cx + pose.x,
          y = (point.y + 0.5) * 16 - cy - pose.y - layer.lift - this.actorElevation(game, actor);
        // Source ordinary center anchor; framework rider offset is explicit.
        const left = pose.flip ? x - sprite.width * (1 - sprite.pivot[0]) : x - sprite.width * sprite.pivot[0];
        const destination = { x: left, y: y - sprite.height * (1 - sprite.pivot[1]),
          width: sprite.width, height: sprite.height - layer.crop };
        for (const offset of this.periodicOffsets(destination, width, height, topology)) {
          const row = point.y + offset.y / 16, depth = fieldCompositionActorDepth({
            position: { y: (range.height * 0.5 - 0.5 - (row - range.y)) * 16,
              z: entity.position.z }, frameY: frame.y, cameraY: sourceCamera.cameraPosition.y,
            clampTileSubY: sourceCamera.clampTileSubY, charaZOffset: actor.native.charaZOffset });
          projectedActors.push({ row, actorId: actor.id, quad: {
            image, source: { x: 0, y: 0, width: sprite.width, height: sprite.height - layer.crop },
            destination: { ...destination, x: destination.x + offset.x, y: destination.y + offset.y },
            flipX: pose.flip, flipY: false, diagonal: false, alpha: pose.alpha, depth,
            materialAlpha: entity.fadeAlpha, depthWrite: entity.fadeAlpha >= 1,
            first: sampleTarget(textures.first), second: sampleTarget(textures.second) } });
        }
      }
    }
    let effects;
    const effectState = game.fieldEffectsSnapshot;
    if (effectState != null && !this.effectsDeferred(game)) {
      if (topology) throw new Error("循环地图字段特效缺少周期投影宿主");
      if (typeof this.effectProvider?.prepare !== "function") throw new Error("来源字段特效缺少粒子、材质和离屏纹理渲染宿主");
      const prepared = this.effectProvider.prepare({ state: structuredClone(effectState),
        camera: structuredClone(sourceCamera), width, height });
      if (!prepared) throw new Error("来源字段特效宿主未准备完整帧");
      effects = prepareSourceFieldEffectBoards({ boards: effectState.boards, frames: prepared.frames,
        boardOrder: prepared.boardOrder, material: prepared.material,
        camera: sourceCamera.cameraPosition, width, height }, { validateFieldEffectBoardMaterial });
    }
    const canvas = this.compositionCanvas(width, height), context = canvas.getContext("2d", { willReadFrequently: true });
    this.background(context, sourceCamera, width, height);
    if (topology) projectedActors.sort((a, b) => a.row - b.row || a.actorId.localeCompare(b.actorId));
    const output = composeFieldNativePixels({ width, height, tiles, actors: projectedActors.map((actor) => actor.quad), ...(effects ? { effects } : {}),
      background: { width, height, data: context.getImageData(0, 0, width, height).data } });
    const imageData = context.createImageData(width, height); imageData.data.set(output.data);
    for (const omission of omissions) if (!this.presentationOmissions.some((prior) =>
      prior.kind === omission.kind && prior.actorId === omission.actorId)) this.presentationOmissions.push(omission);
    return imageData;
  }
  background(context, sourceCamera, width, height) {
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#09111b";
    context.fillRect(0, 0, width, height);
    for (const background of this.content.map.backgrounds ?? []) {
      if (!sourceCamera) throw new Error("来源背景缺少摄像机宿主");
      const image = this.images.get(background.texture.url);
      if (!image) throw new Error("缺少来源背景图像");
      const projection = projectFieldBackground(background, {
        scrollCamera: sourceCamera.cameraPosition,
        renderCamera: background.renderHost.renderCamera,
        rendererWorld: background.renderHost.rendererWorld,
        screen: { width, height }, renderTarget: { width, height },
      });
      for (const { source, destination } of projection.patches)
        context.drawImage(image, source.x, source.y, source.width, source.height,
          destination.x, destination.y, destination.width, destination.height);
    }
  }
  spriteFrame(asset, key, a, pose = null) {
    const char = this.content.characters[asset];
    if (!char) throw new Error("缺少角色 " + asset);
    let f = pose;
    if (!f) {
      // Temporary mounted opening presentation; ordinary actors use the core's resolved frame.
      let animation = char.animations[key];
      if (!animation) throw new Error("缺少动画 " + asset + "/" + key);
      if (a.motion && a.steps % 2 && animation.next) {
        animation = char.animations[animation.next];
        if (!animation) throw new Error("缺少后续动画");
      }
      const t = a.motion ? a.motion.elapsed / a.motion.duration : 1;
      const frame =
        animation.frames[
          Math.min(
            animation.frames.length - 1,
            Math.floor(t * animation.frames.length),
          )
        ];
      if (frame) f = { ...frame, flip: animation.flip !== frame.flip };
    }
    if (!f) throw new Error("空动画");
    return f;
  }
  sprite(asset, key, a, x, y, crop = 0, lift = 0, pose = null) {
    const char = this.content.characters[asset], f = this.spriteFrame(asset, key, a, pose);
    const s = char.sprites[f.sprite],
      image = this.images.get(s.file);
    if (!image) throw new Error("缺少角色图像");
    const c = this.ctx;
    c.save();
    c.translate(Math.round(x + f.x), Math.round(y - f.y - lift));
    c.scale(f.flip ? -1 : 1, 1);
    c.globalAlpha = f.alpha;
    c.drawImage(
      image,
      0,
      0,
      s.width,
      s.height - crop,
      -s.width * s.pivot[0],
      -s.height * (1 - s.pivot[1]),
      s.width,
      s.height - crop,
    );
    c.restore();
  }
  actor(a, cx, cy, p = this.point(a), elevation = 0) {
    // Fresh factory residents may be active without a selected sprite. A zero
    // direction is a native state, never an invitation to invent a facing.
    if (a.asset === null || a.direction === null || (a.native && !a.animation?.frame())) return;
    const x = (p.x + 0.5) * 16 - cx,
      y = (p.y + 1) * 16 - 2 - cy - elevation;
    const key = FACING[a.direction];
    if (a.mount) {
      this.sprite(a.mount, key, a, x, y);
      const ride = { WalkL: "RideL", WalkR: "RideR" }[key] ?? key;
      this.sprite(a.asset, ride, a, x, y, 8, 14);
    } else this.sprite(a.asset, key, a, x, y, 0, 0, a.animation?.frame());
  }
  actorImages(actors, cx, cy, width, height, topology, game = null) {
    if (!topology) return actors.map((actor) => ({ actor, point: this.point(actor) }));
    const images = [];
    for (const actor of actors) {
      if (actor.asset === null || actor.direction === null || actor.native && !actor.animation?.frame()) continue;
      const point = this.point(actor), key = FACING[actor.direction],
        layers = actor.mount ? [
          { asset: actor.mount, key, crop: 0, lift: 0, pose: null },
          { asset: actor.asset, key: { WalkL: "RideL", WalkR: "RideR" }[key] ?? key, crop: 8, lift: 14, pose: null },
        ] : [{ asset: actor.asset, key, crop: 0, lift: 0, pose: actor.animation?.frame() }];
      const bounds = layers.map((layer) => {
        const frame = this.spriteFrame(layer.asset, layer.key, actor, layer.pose),
          sprite = this.content.characters[layer.asset].sprites[frame.sprite];
        if (!sprite || sprite.height <= layer.crop) throw new Error("角色帧缺少有效图像范围");
        const x = Math.round((point.x + 0.5) * 16 - cx + frame.x),
          y = Math.round((point.y + 1) * 16 - 2 - cy - frame.y - layer.lift - this.actorElevation(game, actor));
        return { x: x - sprite.width * (frame.flip ? 1 - sprite.pivot[0] : sprite.pivot[0]),
          y: y - sprite.height * (1 - sprite.pivot[1]), width: sprite.width, height: sprite.height - layer.crop };
      });
      const left = Math.min(...bounds.map((b) => b.x)), top = Math.min(...bounds.map((b) => b.y)),
        rect = { x: left, y: top, width: Math.max(...bounds.map((b) => b.x + b.width)) - left,
          height: Math.max(...bounds.map((b) => b.y + b.height)) - top };
      for (const offset of this.periodicOffsets(rect, width, height, topology))
        images.push({ actor, point: { x: point.x + offset.x / 16, y: point.y + offset.y / 16 } });
    }
    return images.sort((a, b) => a.point.y - b.point.y || a.actor.id.localeCompare(b.actor.id));
  }
  layer(l, cx, cy, w, h, game, layerIndex, topology = null) {
    this.ctx.globalAlpha = l.opacity;
    for (const { x, y, index } of this.tileCells(l, cx, cy, w, h, topology))
      this.tile(
        l.data[index] >>> 0,
        x * 16 - cx,
        y * 16 - cy,
        game.time,
        game.tileAnimations.tile(layerIndex, index),
      );
    this.ctx.globalAlpha = 1;
  }
  /** Development overview: source map/markers, fitted to the current map range. */
  overview(game) {
    const c = this.ctx,
      range = game.collisionRange, topology = this.topology(game);
    const w = this.canvas.width,
      h = this.canvas.height;
    const scale = Math.min(
      (w - 16) / (range.width * 16),
      (h - 16) / (range.height * 16),
    );
    const ox = (w - range.width * 16 * scale) / 2,
      oy = (h - range.height * 16 * scale) / 2;
    c.imageSmoothingEnabled = false;
    c.fillStyle = "#09111b";
    c.fillRect(0, 0, w, h);
    c.save();
    c.translate(ox, oy);
    c.scale(scale, scale);
    c.beginPath();
    c.rect(0, 0, range.width * 16, range.height * 16);
    c.clip();
    for (const [li, l] of this.content.map.layers.entries())
      this.layer(
        l,
        range.x * 16,
        range.y * 16,
        range.width * 16,
        range.height * 16,
        game,
        li,
      );
    c.restore();
    c.save();
    c.beginPath();
    c.rect(ox, oy, range.width * 16 * scale, range.height * 16 * scale);
    c.clip();
    const draw = (point, player = false) => {
      const sprite = this.content.minimap?.icons[point.icon];
      if (!sprite) throw new Error("缺少小地图图标 " + point.icon);
      const image = this.images.get(sprite.file);
      if (!image) throw new Error("缺少小地图图片");
      const factor = w > 300 ? 1.5 : 0.75;
      c.save();
      c.translate(
        ox + (point.x - range.x) * 16 * scale,
        oy + (point.y - range.y) * 16 * scale,
      );
      c.rotate((MINIMAP_ROTATION[point.direction] * Math.PI) / 180);
      if (player) {
        c.shadowColor = "#fff";
        c.shadowBlur = 3;
      }
      c.drawImage(
        image,
        (-sprite.width * factor) / 2,
        (-sprite.height * factor) / 2,
        sprite.width * factor,
        sprite.height * factor,
      );
      c.restore();
    };
    for (const marker of minimapMarkers(game.minimapEntities)) draw(marker);
    const p = topology ? canonicalCell(topology, this.point(game.player)) : this.point(game.player);
    draw(
      { icon: 0, x: p.x + 0.5, y: p.y + 0.5, direction: game.player.direction },
      true,
    );
    c.restore();
  }
  draw(game) {
    if (game.fieldEffectsSnapshot != null && !this.effectsDeferred(game) && typeof this.effectProvider?.prepare !== "function")
      throw new Error("来源字段特效缺少粒子、材质和离屏纹理渲染宿主");
    const c = this.ctx,
      m = this.content.map,
      p = this.point(game.player),
      w = this.canvas.width,
      h = this.canvas.height,
      range = game.collisionRange, topology = this.topology(game);
    const nativeHost = Object.values(game.actors).some((actor) => actor.native) ? m.nativeComposition?.renderHost : undefined;
    if (nativeHost && w * nativeHost.height !== h * nativeHost.width)
      throw new Error("来源字段相机尚未恢复当前宽高比或信箱边界");
    const viewportWidth = nativeHost?.width ?? w, viewportHeight = nativeHost?.height ?? h;
    const camera = (position, start, length, viewport, loop) =>
      Math.round(
        loop ? (position + 0.5) * 16 - viewport / 2 : length * 16 <= viewport
          ? start * 16 + (length * 16 - viewport) / 2
          : Math.max(
              start * 16,
              Math.min(
                (start + length) * 16 - viewport,
                (position + 0.5) * 16 - viewport / 2,
              ),
            ),
      );
    // Source camera offsets are pixels with positive Y pointing upward.
    const sourceCamera = game.cameraProjection({ aspect: viewportWidth / viewportHeight,
      orthographicSize: nativeHost?.orthographicSize ?? h / 2,
      isClamp: true, effectOffset: { x: 0, y: 0 } });
    // CameraFollowing's sprite/entity tracking input is retained separately in
    // sourceCamera.renderCell. This full-map Canvas renderer needs no moving
    // Unity mesh cache; clipping uses the actual, already clamped camera root.
    const cx = sourceCamera ? Math.round((sourceCamera.cameraCell.x + 0.5) * 16 - viewportWidth / 2)
      : camera(p.x + game.cameraOffset.x / 16, range.x, range.width, viewportWidth, topology?.loop.horizontal),
      cy = sourceCamera ? Math.round((sourceCamera.cameraCell.y + 0.5) * 16 - viewportHeight / 2)
      : camera(p.y - game.cameraOffset.y / 16, range.y, range.height, viewportHeight, topology?.loop.vertical);
    const actors = Object.values(game.actors)
      .filter((a) => game.isEntityVisible(a.id) && a.x >= 0 && a.x < m.width && a.y >= 0 && a.y < m.height)
      .sort((a, b) => this.point(a).y - this.point(b).y || a.id.localeCompare(b.id));
    const native = this.prepareFrameworkFlatComposition(game, actors, sourceCamera, cx, cy, viewportWidth, viewportHeight, topology) ??
      this.prepareNativeComposition(game, actors, sourceCamera, cx, cy, viewportWidth, viewportHeight, topology);
    if (!native && game.fieldEffectsSnapshot != null && !this.effectsDeferred(game)) throw new Error("来源字段特效需要共享原生颜色与深度缓冲");
    const actorImages = native ? [] : this.actorImages(actors, cx, cy, w, h, topology, game);
    c.imageSmoothingEnabled = false;
    const auto=game.worldAutoPose?projectFlatWorldAutoPose(game.worldAutoPose):null;
    if(auto){c.fillStyle='#09111b';c.fillRect(0,0,w,h);}
    c.save();
    try {
    if(auto){c.translate(w/2,h/2+auto.offsetY);c.rotate(auto.radians);c.scale(auto.scale,auto.scale);c.translate(-w/2,-h/2);}
    if (native) {
      const scaled = scaleFieldCompositionPixels(native, w, h), frame = c.createImageData(w, h);
      frame.data.set(scaled.data);
      if(auto){const canvas=this.compositionCanvas(w,h);canvas.getContext('2d').putImageData(frame,0,0);c.drawImage(canvas,0,0);}
      else c.putImageData(frame, 0, 0);
    }
    else this.background(c, sourceCamera, w, h);
    const drawActors = (layer) => {
      for (const { actor, point } of actorImages) if (actor.layer === layer) this.actor(actor, cx, cy, point, this.actorElevation(game, actor));
    };
    if (!native) for (const [li, l] of m.layers.entries()) {
        this.layer(l, cx, cy, w, h, game, li, topology);
        if (l.name === "BottomLayer") drawActors(0);
        if (l.name === "GroundLayer") drawActors(1);
        if (l.name === "UpperLayer") drawActors(2);
        if (l.name === "CeilLayer") drawActors(3);
      }
    } finally {c.restore();}
    const message = game.sourceMessage?.projection;
    // The sequence projection uses the shared DOM dialogue panel, which wraps
    // and scrolls complete source pages. The old v1 short subtitle stays here.
    if (message && message.documentKind !== "source-message-sequence-v1") {
      const lines = message.text.split("\n"), lineHeight = 24;
      const startY = message.anchor === "top" ? 28 : message.anchor === "middle"
        ? (h - lines.length * lineHeight) / 2 : h - 28 - lines.length * lineHeight;
      c.save();
      c.font = '16px system-ui, "PingFang SC", sans-serif';
      c.textBaseline = "top";
      c.textAlign = message.alignment;
      c.fillStyle = "#fff";
      c.shadowColor = "#000"; c.shadowBlur = 2;
      for (const [index, line] of lines.entries()) c.fillText(line,
        message.alignment === "center" ? w / 2 : 28, startY + lineHeight * index);
      c.restore();
    }
    const filter = game.colorFilter;
    if (filter && filter.a > 0) {
      c.fillStyle = `rgba(${filter.r * 255},${filter.g * 255},${filter.b * 255},${filter.a})`;
      c.fillRect(0, 0, w, h);
    }
    if (game.fade) {
      const color = fieldFadeOverlay(game.fade);
      c.fillStyle = `rgba(${color.r * 255},${color.g * 255},${color.b * 255},${color.a})`;
      c.fillRect(0, 0, w, h);
    }
    drawStoryTimer(c, w, game.timerProjection);
  }
}
