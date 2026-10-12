import { minimapMarkers, MINIMAP_ROTATION } from "/runtime/core/minimap.js";
import { FIELD_POSE as FACING } from "/runtime/core/actor-animation.js";
import { fieldFadeOverlay } from "/runtime/core/field-fade.js";
import { projectFieldBackground } from "/runtime/core/field-background.js";
import { assertFieldCompositionRenderTargets, composeFieldNativePixels,
  fieldCompositionActorDepth, fieldCompositionTileDepth, fieldCompositionActorTextures,
  validateFieldNativeComposition, prepareFieldCompositionTargets,
  scaleFieldCompositionPixels } from "/runtime/core/field-native-composition.js";
import { projectFieldActorView, validateFieldActorViewProjection } from "/runtime/core/field-actor-view.js";
import { canonical } from "/runtime/core/canonical.js";
export class Renderer {
  constructor(canvas, content, images) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.content = content;
    this.images = images;
    this.nativePixels = new WeakMap();
    this.presentationOmissions = [];
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
  point(a) {
    const m = a.motion;
    if (!m) return a;
    const t = Math.min(1, m.elapsed / m.duration);
    return {
      x: m.from.x + (m.to.x - m.from.x) * t,
      y: m.from.y + (m.to.y - m.from.y) * t,
    };
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
  /** Native material preparation is complete before drawing to the visible
   * Canvas. Render targets are transient pixels; the existing actors remain
   * the only state owner. Legacy/development actors retain their old lane. */
  prepareNativeComposition(game, actors, sourceCamera, cx, cy, width, height) {
    const m = this.content.map, definition = m.nativeComposition;
    if (!definition || !Object.values(game.actors).some((actor) => actor.native)) return null;
    validateFieldNativeComposition(definition);
    assertFieldCompositionRenderTargets(definition);
    const host = this.content.cameraHost;
    if (!sourceCamera || !host || host.loop.horizontal || host.loop.vertical)
      throw new Error("原生普通材质缺少非循环相机投影");
    const range = host.mapRange, tiles = [], projectedActors = [], omissions = [];
    if (definition.view.mapSize.width !== range.width || definition.view.mapSize.height !== range.height)
      throw new Error("原生材质地图范围与来源不符");
    for (const [li, layer] of m.layers.entries()) {
      if (!definition.layers.includes(layer.name) || layer.opacity !== 1)
        throw new Error("未绑定的原生图层材质");
      for (let y = Math.max(range.y, 0, Math.floor(cy / 16)); y < Math.min(range.y + range.height, layer.height, Math.ceil((cy + height) / 16)); y++) {
        for (let x = Math.max(range.x, 0, Math.floor(cx / 16)); x < Math.min(range.x + range.width, layer.width, Math.ceil((cx + width) / 16)); x++) {
          const raw = layer.data[y * layer.width + x] >>> 0;
          const gid = (game.tileAnimations.tile(li, y * layer.width + x) ?? raw) & 0x0fffffff;
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
    }
    const targets = definition.renderHost ? prepareFieldCompositionTargets(definition, { width, height, tiles })
      : { upper: null, ceil: null };
    const sampleTarget = (name) => name === null ? null : name === definition.upperTexture ? targets.upper
      : name === definition.ceilTexture ? targets.ceil : (() => { throw new Error("未绑定的原生预渲染纹理"); })();
    for (const actor of actors) {
      if (!actor.native) throw new Error("原生材质视口混入未绑定演员");
      const entity = actor.native.entity, frame = actor.animation?.frame();
      if (!frame || actor.asset === null) continue;
      if (!entity.character || entity.riding || !entity.bodyOpaque || entity.fadeAlpha !== 1)
        throw new Error("原生普通材质不支持当前骑乘或透明提供器");
      if (entity.shadowVisible) omissions.push({ kind: "native-character-shadow", actorId: actor.id });
      if (!entity.viewBinding?.properties) throw new Error("原生演员缺少普通材质绑定");
      validateFieldActorViewProjection(entity.viewBinding.properties, definition.contextId, entity.layer);
      if (canonical(entity.viewBinding.properties) !== canonical(projectFieldActorView(definition.view, entity.layer)))
        throw new Error("原生演员材质参数未绑定当前地图完整来源");
      const textures = fieldCompositionActorTextures(definition, entity.layer);
      if (entity.transparentTextures.first !== textures.first || entity.transparentTextures.second !== textures.second)
        throw new Error("原生演员的上层纹理属于其他地图或层");
      const character = this.content.characters[actor.asset], sprite = character?.sprites[frame.sprite];
      if (!sprite) throw new Error("原生角色帧缺少来源图像");
      const image = this.compositionPixels(sprite.file);
      if (image.width !== sprite.width || image.height !== sprite.height) throw new Error("原生角色图像几何不符");
      const point = this.point(actor), x = (point.x + 0.5) * 16 - cx + frame.x,
        y = (point.y + 0.5) * 16 - cy - frame.y;
      // FF6 SerialOffset(+6) and prefab Offset(-6) cancel. Do not reuse the
      // legacy bottom-2 anchor, which omitted the serial provider.
      const left = frame.flip ? x - sprite.width * (1 - sprite.pivot[0]) : x - sprite.width * sprite.pivot[0];
      projectedActors.push({ image, source: { x: 0, y: 0, width: sprite.width, height: sprite.height },
        destination: { x: left, y: y - sprite.height * (1 - sprite.pivot[1]), width: sprite.width, height: sprite.height },
        flipX: frame.flip, flipY: false, diagonal: false, alpha: frame.alpha,
        depth: fieldCompositionActorDepth({ position: { y: (range.height * 0.5 - 0.5 - (point.y - range.y)) * 16,
          z: entity.position.z }, frameY: frame.y, cameraY: sourceCamera.cameraPosition.y,
          clampTileSubY: sourceCamera.clampTileSubY, charaZOffset: actor.native.charaZOffset }),
        first: sampleTarget(textures.first), second: sampleTarget(textures.second) });
    }
    const canvas = this.compositionCanvas(width, height), context = canvas.getContext("2d", { willReadFrequently: true });
    this.background(context, sourceCamera, width, height);
    const output = composeFieldNativePixels({ width, height, tiles, actors: projectedActors,
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
  sprite(asset, key, a, x, y, crop = 0, lift = 0, pose = null) {
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
  actor(a, cx, cy) {
    // Fresh factory residents may be active without a selected sprite. A zero
    // direction is a native state, never an invitation to invent a facing.
    if (a.asset === null || a.direction === null || (a.native && !a.animation?.frame())) return;
    const p = this.point(a),
      x = (p.x + 0.5) * 16 - cx,
      y = (p.y + 1) * 16 - 2 - cy;
    const key = FACING[a.direction];
    if (a.mount) {
      this.sprite(a.mount, key, a, x, y);
      const ride = { WalkL: "RideL", WalkR: "RideR" }[key] ?? key;
      this.sprite(a.asset, ride, a, x, y, 8, 14);
    } else this.sprite(a.asset, key, a, x, y, 0, 0, a.animation?.frame());
  }
  layer(l, cx, cy, w, h, game, layerIndex) {
    this.ctx.globalAlpha = l.opacity;
    for (
      let y = Math.max(0, Math.floor(cy / 16));
      y < Math.min(l.height, Math.ceil((cy + h) / 16));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(cx / 16));
        x < Math.min(l.width, Math.ceil((cx + w) / 16));
        x++
      )
        this.tile(
          l.data[y * l.width + x] >>> 0,
          x * 16 - cx,
          y * 16 - cy,
          game.time,
          game.tileAnimations.tile(layerIndex, y * l.width + x),
        );
    this.ctx.globalAlpha = 1;
  }
  /** Development overview: source map/markers, fitted to the current map range. */
  overview(game) {
    const c = this.ctx,
      range = game.collisionRange;
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
    const p = this.point(game.player);
    draw(
      { icon: 0, x: p.x + 0.5, y: p.y + 0.5, direction: game.player.direction },
      true,
    );
    c.restore();
  }
  draw(game) {
    if (game.fieldEffectsSnapshot != null)
      throw new Error("来源字段特效缺少粒子、材质和离屏纹理渲染宿主");
    const c = this.ctx,
      m = this.content.map,
      p = this.point(game.player),
      w = this.canvas.width,
      h = this.canvas.height,
      range = game.collisionRange;
    const nativeHost = Object.values(game.actors).some((actor) => actor.native) ? m.nativeComposition?.renderHost : undefined;
    if (nativeHost && w * nativeHost.height !== h * nativeHost.width)
      throw new Error("来源字段相机尚未恢复当前宽高比或信箱边界");
    const viewportWidth = nativeHost?.width ?? w, viewportHeight = nativeHost?.height ?? h;
    const camera = (position, start, length, viewport) =>
      Math.round(
        length * 16 <= viewport
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
      : camera(p.x + game.cameraOffset.x / 16, range.x, range.width, viewportWidth),
      cy = sourceCamera ? Math.round((sourceCamera.cameraCell.y + 0.5) * 16 - viewportHeight / 2)
      : camera(p.y - game.cameraOffset.y / 16, range.y, range.height, viewportHeight);
    const actors = Object.values(game.actors)
      .filter((a) => game.isEntityVisible(a.id) && a.x >= 0 && a.x < m.width && a.y >= 0 && a.y < m.height)
      .sort((a, b) => this.point(a).y - this.point(b).y || a.id.localeCompare(b.id));
    const native = this.prepareNativeComposition(game, actors, sourceCamera, cx, cy, viewportWidth, viewportHeight);
    c.imageSmoothingEnabled = false;
    if (native) {
      const scaled = scaleFieldCompositionPixels(native, w, h), frame = c.createImageData(w, h);
      frame.data.set(scaled.data); c.putImageData(frame, 0, 0);
    }
    else this.background(c, sourceCamera, w, h);
    const drawActors = (layer) => {
      for (const a of actors) if (a.layer === layer) this.actor(a, cx, cy);
    };
    if (!native) for (const [li, l] of m.layers.entries()) {
        this.layer(l, cx, cy, w, h, game, li);
        if (l.name === "BottomLayer") drawActors(0);
        if (l.name === "GroundLayer") drawActors(1);
        if (l.name === "UpperLayer") drawActors(2);
        if (l.name === "CeilLayer") drawActors(3);
      }
    const message = game.sourceMessage?.projection;
    if (message) {
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
    if (game.fade) {
      const color = fieldFadeOverlay(game.fade);
      c.fillStyle = `rgba(${color.r * 255},${color.g * 255},${color.b * 255},${color.a})`;
      c.fillRect(0, 0, w, h);
    }
  }
}
