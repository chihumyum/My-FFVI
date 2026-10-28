import {
  Assets,
  Container,
  Mesh,
  MeshGeometry,
  RenderTexture,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import { PRMaterialCache } from "./pr-filters.js";

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const usableTexture = (texture) =>
  texture &&
  !texture.destroyed &&
  texture.source &&
  !texture.source.destroyed &&
  texture.source.style;
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const point = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
function multiply(a, b) {
  const c = Array(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) c[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return c;
}
function matrix(node) {
  const [x, y, z, w] = node.rotation,
    [sx, sy, sz] = node.scale,
    [px, py, pz] = node.position;
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    px,
    py,
    pz,
    1,
  ];
}
function eulerQuaternion([x, y, z]) {
  // Unity's authored local Euler order is ZXY.
  const axis = (axis, value) => {
    const q = [0, 0, 0, Math.cos((value * Math.PI) / 360)];
    q[axis] = Math.sin((value * Math.PI) / 360);
    return q;
  };
  const qmul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  return qmul(axis(1, y), qmul(axis(0, x), axis(2, z)));
}

/** Scalar values retain the PR streamed cubic/dense/constant curve ordering. */
export function sampleOperaCurve(animation, index, time) {
  if (index < animation.stream.length) {
    const keys = animation.stream[index];
    if (!keys?.length) return 0;
    let low = 0,
      high = keys.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (keys[mid][0] <= time) low = mid + 1;
      else high = mid;
    }
    const key = keys[Math.max(0, low - 1)],
      dt = key[0] < -1e10 ? 0 : Math.max(0, time - key[0]);
    return ((key[1] * dt + key[2]) * dt + key[3]) * dt + key[4];
  }
  index -= animation.stream.length;
  const d = animation.dense;
  if (index < d.count) {
    const frame = clamp((time - d.start) * d.rate, 0, Math.max(0, d.frames - 1)),
      a = Math.floor(frame),
      b = Math.min(a + 1, d.frames - 1),
      f = frame - a;
    return (
      (d.values[a * d.count + index] || 0) * (1 - f) + (d.values[b * d.count + index] || 0) * f
    );
  }
  return animation.constants[index - d.count] ?? 0;
}

/** Pure scene sample for export checks and renderer playback; never touches Game. */
export function sampleOpera(catalog, stage, seconds = 0) {
  const selection = typeof stage === "object" ? stage : catalog.stages[stage];
  if (!selection) return null;
  const scene = catalog.scenes[selection.scene],
    timeline = scene.timelines[selection.timeline];
  const time = clamp(selection.start + seconds, selection.start, selection.end),
    nodes = scene.nodes.map((n) => ({
      ...n,
      position: [...n.position],
      rotation: [...n.rotation],
      scale: [...n.scale],
      properties: {},
    }));
  const tracked = new Set(
      timeline.tracks.filter((t) => t.root !== null && t.type !== "AudioTrack").map((t) => t.root),
    ),
    allowed = new Set();
  for (const root of tracked) {
    let n = root;
    while (nodes[n]?.parent !== null) n = nodes[n].parent;
    allowed.add(n);
  }
  if (timeline.root !== null) {
    let n = timeline.root;
    while (nodes[n]?.parent !== null) n = nodes[n].parent;
    allowed.add(n);
  }
  for (const n of nodes) if (n.parent === null && !allowed.has(n.id)) n.active = false;
  const activation = new Map();
  for (const track of timeline.tracks.filter(
    (t) => t.type === "ActivationTrack" && !t.muted && t.root !== null,
  )) {
    activation.set(
      track.root,
      track.clips.some((c) => time >= c.start && time < c.start + c.duration),
    );
  }
  for (const root of tracked) if (!activation.has(root)) nodes[root].active = false;
  for (const [root, active] of activation) nodes[root].active = active;
  const activeClips = [];
  for (const track of timeline.tracks) {
    if (track.muted || track.type !== "AnimationTrack" || track.root === null) continue;
    for (const clip of track.clips) {
      if (!clip.animation || time < clip.start || time >= clip.start + clip.duration) continue;
      if (!activation.has(track.root)) nodes[track.root].active = true;
      const animation = catalog.animations[clip.animation];
      let local = (time - clip.start) * clip.speed + clip.in;
      local =
        clip.loop && animation.duration > 0
          ? local % animation.duration
          : clamp(local, 0, animation.duration);
      activeClips.push({ name: animation.name, root: track.root, time: local });
      for (let i = 0; i < animation.channels.length; i++) {
        const binding = animation.channels[i],
          id = clip.bindings?.[i];
        if (id === null || id === undefined) continue;
        const node = nodes[id],
          values = Array.from({ length: binding.size }, (_, n) =>
            sampleOperaCurve(animation, binding.offset + n, local),
          );
        if (binding.property === "position")
          node.position = values.map((v, n) => v + (clip.offset?.[n] || 0));
        else if (binding.property === "rotation") node.rotation = values;
        else if (binding.property === "scale") node.scale = values;
        else if (binding.property === "euler") node.rotation = eulerQuaternion(values);
        else if (binding.property === "sprite")
          node.properties.sprite = animation.pointers[Math.round(values[0])] ?? null;
        else if (binding.property === "m_IsActive") node.active = values[0] >= 0.5;
        else if (binding.property) node.properties[binding.property] = values[0];
      }
    }
  }
  const world = Array(nodes.length),
    visible = Array(nodes.length);
  const compute = (id) => {
    if (world[id]) return;
    const node = nodes[id],
      local = matrix(node);
    if (node.parent === null) {
      world[id] = local;
      visible[id] = node.active;
    } else {
      compute(node.parent);
      world[id] = multiply(world[node.parent], local);
      visible[id] = visible[node.parent] && node.active;
    }
  };
  nodes.forEach((n) => compute(n.id));
  const cameras = scene.cameras
    .map((c) => ({
      ...c,
      world: world[c.node],
      fov: nodes[c.node].properties["field of view"] ?? c.fov,
      size: nodes[c.node].properties["orthographic size"] ?? c.size,
      near: nodes[c.node].properties["near clip plane"] ?? c.near,
      far: nodes[c.node].properties["far clip plane"] ?? c.far,
      enabled: visible[c.node] && (nodes[c.node].properties.m_Enabled ?? c.enabled),
    }))
    .filter((c) => c.enabled);
  return { scene, selection, time, nodes, world, visible, cameras, activeClips };
}

function projection(camera, width, height) {
  const m = camera.world,
    basis = [0, 4, 8].map((i) => {
      const length = Math.hypot(m[i], m[i + 1], m[i + 2]) || 1;
      return [m[i] / length, m[i + 1] / length, m[i + 2] / length];
    });
  const vp = camera.viewport || { x: 0, y: 0, width: 1, height: 1 },
    w = width * vp.width,
    h = height * vp.height,
    aspect = w / h;
  const tangent = Math.tan(((camera.fov || 60) * Math.PI) / 360),
    size = camera.size || 32;
  return (p) => {
    const delta = [p[0] - m[12], p[1] - m[13], p[2] - m[14]],
      v = basis.map((a) => a.reduce((s, x, n) => s + x * delta[n], 0));
    const z = v[2],
      scale = camera.orthographic ? size : Math.max(camera.near || 0.01, z) * tangent;
    return [
      width * vp.x + w * (0.5 + v[0] / (2 * scale * aspect)),
      height * (1 - vp.y - vp.height) + h * (0.5 - v[1] / (2 * scale)),
      z,
    ];
  };
}

function geometryFor(catalog, renderer, state) {
  const properties = state.nodes[renderer.node].properties;
  if (renderer.type === "SpriteRenderer") {
    const image = catalog.images[properties.sprite ?? renderer.sprite];
    if (!image) return null;
    if (image.mesh?.vertices?.length)
      return {
        vertices: image.mesh.vertices,
        uv: image.mesh.uv,
        submeshes: [image.mesh.indices],
        image,
      };
    const x = image.width / image.ppu,
      y = image.height / image.ppu,
      [px, py] = image.pivot;
    return {
      vertices: [
        [-px * x, -py * y, 0],
        [(1 - px) * x, -py * y, 0],
        [(1 - px) * x, (1 - py) * y, 0],
        [-px * x, (1 - py) * y, 0],
      ],
      uv: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      submeshes: [[0, 1, 2, 0, 2, 3]],
      image,
    };
  }
  return catalog.meshes[renderer.mesh] || null;
}

/** Screen geometry is also exposed for non-browser source projection checks. */
export function operaDrawList(catalog, state, width = 384, height = 216, sourceCamera = null) {
  if (!state) return [];
  const available = state.scene.renderers.filter((r) => state.visible[r.node] && r.enabled);
  const candidates = sourceCamera
    ? [sourceCamera]
    : state.cameras.some((c) => !c.targetTexture)
      ? state.cameras.filter((c) => !c.targetTexture)
      : state.cameras;
  const cameras = candidates
    .map((camera) => {
      const project = projection(camera, width, height);
      let score = 0;
      for (const r of available) {
        if (!(camera.mask & (1 << state.nodes[r.node].layer))) continue;
        const p = project(point(state.world[r.node], [0, 0, 0]));
        if (
          p[2] > camera.near &&
          p[2] < camera.far &&
          p[0] > -width &&
          p[0] < width * 2 &&
          p[1] > -height &&
          p[1] < height * 2
        )
          score++;
      }
      return { camera, project, score };
    })
    .sort((a, b) => b.score - a.score || b.camera.depth - a.camera.depth);
  const primary = cameras[0];
  if (!primary) return [];
  const rows = [];
  for (const r of available) {
    const props = state.nodes[r.node].properties;
    if (props.m_Enabled === 0) continue;
    if (!(primary.camera.mask & (1 << state.nodes[r.node].layer))) continue;
    const geometry = geometryFor(catalog, r, state);
    if (!geometry?.vertices?.length) continue;
    const world = state.world[r.node],
      points = geometry.vertices.map((p, index) => {
        if (geometry.weights?.[index] && geometry.bindPoses?.length && r.bones?.length) {
          const v = [0, 0, 0];
          let sum = 0;
          for (let n = 0; n < geometry.weights[index].length; n++) {
            const weight = geometry.weights[index][n],
              bone = geometry.boneIndices[index][n],
              node = r.bones[bone];
            if (!weight || node === null || node === undefined || !geometry.bindPoses[bone])
              continue;
            const position = point(state.world[node], point(geometry.bindPoses[bone], p));
            for (let axis = 0; axis < 3; axis++) v[axis] += position[axis] * weight;
            sum += weight;
          }
          if (sum > 0) return v;
        }
        return point(world, [p[0] * (r.flipX ? -1 : 1), p[1] * (r.flipY ? -1 : 1), p[2]]);
      });
    const projected = points.map(primary.project),
      depth = projected.reduce((n, p) => n + p[2], 0) / projected.length;
    if (
      projected.every((p) => p[2] < primary.camera.near) ||
      projected.every((p) => p[2] > primary.camera.far)
    )
      continue;
    // Cull only a fully disjoint projected rectangle. Checking an object's
    // origin would discard the large authored scenery planes whose pivots
    // sit outside the viewport while their visible geometry crosses it.
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of projected) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    if (maxX < 0 || maxY < 0 || minX > width || minY > height) continue;
    const color = [...r.color];
    for (let n = 0; n < 4; n++) color[n] = props[`m_Color.${"rgba"[n]}`] ?? color[n];
    if (color[3] <= 0) continue;
    for (const [submesh, indices] of geometry.submeshes.entries())
      if (indices.length) {
        const material = r.materials[submesh] || r.materials[0],
          source = catalog.materials[material],
          floats = { ...source?.floats };
        for (const [key, value] of Object.entries(props))
          if (key.startsWith("material.")) floats[key.slice(9)] = value;
        const tint = source?.colors?._Color || [1, 1, 1, 1],
          c = color.map((v, n) => v * tint[n]);
        c[3] *= (floats._Alpha ?? 1) * Math.max(0, 1 + (floats._AEmission || 0));
        if (c[3] <= 0) continue;
        rows.push({
          key: `${r.node}:${submesh}`,
          node: r.node,
          renderer: r,
          positions: projected.flatMap((p) => p.slice(0, 2)),
          uv: geometry.uv,
          indices,
          depth,
          order: props.m_SortingOrder ?? r.order,
          image: geometry.image,
          material,
          // Unity's opera stage/character shaders use authored AlphaTest
          // queues and depth testing despite their alpha-blended textures.
          // Draw that geometry far-to-near so a nearer actor is not painted
          // over by a farther castle merely because its SortingOrder is 1/2.
          // Native per-pixel Shader depth is still an explicit approximation.
          depthSorted:
            source?.renderQueue < 3000 && source?.depthTest > 0 && source.depthTest !== 8,
          renderQueue: source?.renderQueue ?? 3000,
          floats,
          color: c,
          properties: props,
          camera: primary.camera.node,
        });
      }
  }
  return rows.sort((a, b) => {
    if (a.depthSorted !== b.depthSorted) return a.depthSorted ? -1 : 1;
    if (a.depthSorted && b.depthSorted)
      return b.depth - a.depth || a.renderQueue - b.renderQueue || a.order - b.order;
    return (
      a.renderer.sortingLayer - b.renderer.sortingLayer || a.order - b.order || b.depth - a.depth
    );
  });
}

export function operaCaption(catalog, state, messages = null) {
  const active = (state.scene.texts || []).filter(
      (text) =>
        state.visible[text.node] &&
        (state.nodes[text.node].properties.m_Enabled ?? text.enabled) &&
        (state.nodes[text.node].properties["m_Color.a"] ?? text.color[3]) > 0.05,
    ),
    votes = new Map();
  for (const text of active)
    for (const id of text.captions) votes.set(id, (votes.get(id) || 0) + text.text.trim().length);
  const id = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0],
    sourceText = [...new Set(active.map((text) => text.text.trim()).filter(Boolean))].join(" ");
  return {
    id,
    text: id
      ? String(messages?.[id] || catalog.captions[id].zh || catalog.captions[id].ja)
          .replace(/<[^>]*>/g, "")
          .replace(/\\n/g, "\n")
      : sourceText,
    sourceText,
  };
}

/** Presentation-only host. A caller pauses the field VM while `active` is true. */
export class OperaPlayer {
  constructor({
    parent = null,
    renderer = null,
    getTexture = null,
    warn = console.warn,
    onEnd = () => {},
    onAudio = () => {},
    width = 384,
    height = 216,
    audioLanguage = "JPN",
    fontFamily = "system-ui",
  } = {}) {
    this.container = new Container({ label: "pr-opera", sortableChildren: false });
    parent?.addChild(this.container);
    this.warn = warn;
    this.onEnd = onEnd;
    this.onAudio = onAudio;
    this.width = width;
    this.height = height;
    this.audioLanguage = audioLanguage;
    this.getTexture = getTexture || ((url) => Assets.get(url) || null);
    this.renderer = renderer;
    this.ownsTextures = !getTexture;
    this.materials = renderer
      ? new PRMaterialCache({ renderer, getTexture: this.getTexture, warn })
      : null;
    this.draws = new Map();
    this.targets = new Map();
    this.passContainers = new Map();
    this.active = false;
    this.time = 0;
    this.duration = 0;
    this.container.visible = false;
    this.audioCues = new Set();
    this.background = new Sprite(Texture.WHITE);
    this.background.tint = 0;
    this.background.width = width;
    this.background.height = height;
    this.container.addChild(this.background);
    this.caption = new Text({
      text: "",
      style: {
        fontFamily,
        fontSize: 12,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
        align: "center",
        wordWrap: true,
        wordWrapWidth: width - 24,
        lineHeight: 16,
      },
    });
    this.caption.anchor.set(0.5, 1);
    this.caption.position.set(width / 2, height - 10);
    this.container.addChild(this.caption);
    this.captionWarnings = new Set();
  }
  async load(url = "/web-data/opera.json") {
    this.catalog = typeof url === "object" ? url : await (await fetch(url)).json();
    for (const warning of this.catalog.warnings || []) this.warn(warning);
    return this;
  }
  select(stage) {
    if (!this.catalog) throw new Error("OperaPlayer.load must finish before selecting a stage");
    const selection = typeof stage === "object" ? stage : this.catalog.stages[stage];
    if (!selection) {
      this.warn(`No PR opera stage ${stage}`);
      return false;
    }
    this.stop(false);
    // The host owns image/atlas lifetime. A scene switch must release our
    // old Mesh and preprocessing references before that host evicts pages.
    for (const entry of this.draws.values())
      entry.mesh.destroy({ geometry: true, texture: false, textureSource: false });
    this.draws.clear();
    for (const container of this.passContainers.values()) container.destroy();
    this.passContainers.clear();
    for (const texture of this.targets.values()) texture.destroy(true);
    this.targets.clear();
    this.materials?.clear();
    this.selection = selection;
    this.stage = stage;
    this.time = 0;
    this.duration = selection.end - selection.start;
    this.audioCues.clear();
    return true;
  }
  play(stage = this.stage) {
    if (!this.select(stage)) return false;
    this.active = true;
    this.container.visible = true;
    if (this.ownsTextures) {
      const scene = this.catalog.scenes[this.selection.scene];
      const urls = new Set(
        scene.renderers.flatMap((r) => {
          const sprite = this.catalog.images[r.sprite]?.url,
            main = this.catalog.materials[r.materials[0]]?.textures?._MainTex?.url;
          return [sprite, main].filter(Boolean);
        }),
      );
      for (const url of urls)
        Assets.load(url).catch((error) => this.warn(`Opera texture ${url}: ${error.message}`));
    }
    this.render();
    return true;
  }
  update(dt) {
    if (!this.active || !Number.isFinite(dt) || dt < 0) return;
    this.time = Math.min(this.duration, this.time + dt);
    this.render();
    if (this.time >= this.duration) this.stop(true);
  }
  render() {
    if (!this.selection) return;
    const state = sampleOpera(
      this.catalog,
      this.selection,
      Math.min(this.time, Math.max(0, this.duration - 1e-5)),
    );
    this.state = state;
    this.materials?.beginFrame();
    const timeline = state.scene.timelines[this.selection.timeline];
    for (const [index, track] of timeline.tracks.entries())
      if (track.type === "AudioTrack")
        for (const [n, clip] of track.clips.entries()) {
          const key = `${index}:${n}`;
          if (
            clip.audio &&
            state.time >= clip.start &&
            state.time < clip.start + clip.duration &&
            !this.audioCues.has(key)
          ) {
            this.audioCues.add(key);
            const cue = this.catalog.audio?.[clip.audio],
              variant = cue?.variants?.[this.audioLanguage] || cue?.variants?.default;
            this.onAudio({
              name: clip.audio,
              ...(variant || {}),
              variants: cue?.variants || {},
              time: state.time - clip.start + clip.in,
              duration: clip.duration,
              stage: this.stage,
            });
          }
        }
    for (const draw of this.draws.values()) {
      draw.mesh.visible = false;
      // Also invalidate the Mesh batch's old source, rather than retaining a
      // now-invisible atlas view that the owner may asynchronously unload.
      draw.mesh.texture = Texture.EMPTY;
    }
    // PR renders small orthographic actor cameras into authored 32/64/512px
    // textures and places those textures on stage meshes. Preserve that
    // camera-to-texture graph instead of replacing the planes with white.
    if (this.renderer)
      for (const camera of [...state.cameras]
        .filter((c) => c.targetTexture)
        .sort((a, b) => a.depth - b.depth)) {
        const descriptor = this.catalog.renderTextures[camera.targetTexture];
        if (!descriptor) continue;
        let target = this.targets.get(camera.targetTexture);
        if (!target) {
          target = RenderTexture.create({
            width: descriptor.width,
            height: descriptor.height,
            resolution: 1,
            scaleMode: "nearest",
            antialias: false,
          });
          this.targets.set(camera.targetTexture, target);
        }
        let pass = this.passContainers.get(camera.node);
        if (!pass) {
          pass = new Container({ label: `opera-camera-${camera.node}` });
          this.passContainers.set(camera.node, pass);
        }
        this._draw(
          operaDrawList(this.catalog, state, descriptor.width, descriptor.height, camera),
          pass,
          `camera${camera.node}:`,
        );
        this.renderer.render({
          container: pass,
          target,
          clear: true,
          clearColor: camera.background,
        });
      }
    this._draw(
      operaDrawList(this.catalog, state, this.width, this.height),
      this.container,
      "view:",
    );
    const caption = operaCaption(this.catalog, state, this.messages);
    this.caption.text = caption.text;
    this.caption.visible = !!caption.text;
    this.container.addChild(this.caption);
    if (caption.sourceText && !caption.id && !this.captionWarnings.has(caption.sourceText)) {
      this.captionWarnings.add(caption.sourceText);
      this.warn(
        `Opera Text has no unambiguous source Chinese message: ${caption.sourceText.slice(0, 80)}`,
      );
    }
    this.materials?.prune(this.time);
  }
  _draw(rows, parent, prefix) {
    for (const row of rows) {
      const source = this.catalog.materials[row.material],
        url = row.image?.url || source?.textures?._MainTex?.url;
      const targetKey = !row.image && source?.textures?._MainTex?.renderTexture;
      let texture = targetKey
        ? this.targets.get(targetKey)
        : url
          ? this.getTexture(url)
          : Texture.WHITE;
      if (!usableTexture(texture)) {
        if (this.ownsTextures && url) Assets.load(url).catch(() => {});
        continue;
      }
      let entry = this.draws.get(prefix + row.key);
      if (
        entry &&
        (entry.mesh.geometry.positions.length !== row.positions.length ||
          entry.mesh.geometry.indices.length !== row.indices.length)
      ) {
        entry.mesh.destroy({ geometry: true, texture: false, textureSource: false });
        this.draws.delete(prefix + row.key);
        entry = null;
      }
      if (!entry) {
        const uv = row.uv.flatMap((p) => [p[0] || 0, 1 - (p[1] || 0)]),
          positions = new Float32Array(row.positions);
        const geometry = new MeshGeometry({
          positions,
          uvs: new Float32Array(uv),
          indices: new Uint32Array(row.indices),
        });
        const mesh = new Mesh({ geometry, texture, roundPixels: false });
        entry = { mesh, material: null };
        this.draws.set(prefix + row.key, entry);
      }
      const mesh = entry.mesh;
      mesh.geometry.positions.set(row.positions);
      mesh.geometry.getBuffer("aPosition").update();
      mesh.geometry.uvs.set(row.uv.flatMap((p) => [p[0] || 0, 1 - (p[1] || 0)]));
      mesh.geometry.getBuffer("aUV").update();
      mesh.geometry.indices.set(row.indices);
      mesh.geometry.indexBuffer.update();
      if (source && !row.image && !targetKey && this.materials) {
        entry.material ??= {
          ...source,
          floats: { ...source.floats },
          colors: { ...source.colors, _Color: [1, 1, 1, 1] },
        };
        Object.assign(entry.material.floats, row.floats, { _AEmission: 0, _Alpha: 1 });
        const filtered =
          this.materials.handles(entry.material) && this.materials.get(entry.material, this.time);
        if (usableTexture(filtered)) texture = filtered;
      }
      mesh.texture = texture;
      mesh.visible = true;
      mesh.alpha = clamp(row.color[3]);
      const c = row.color.map((v) => clamp(v));
      mesh.tint =
        (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
      mesh.blendMode = source?.blendMode || "normal";
      parent.addChild(mesh);
    }
  }
  stop(notify = false) {
    const wasActive = this.active;
    this.active = false;
    this.container.visible = false;
    if (notify && wasActive) this.onEnd({ stage: this.stage, duration: this.duration });
  }
  destroy() {
    this.stop();
    for (const entry of this.draws.values()) entry.mesh.destroy({ geometry: true });
    this.draws.clear();
    for (const texture of this.targets.values()) texture.destroy(true);
    this.targets.clear();
    for (const container of this.passContainers.values()) container.destroy();
    this.passContainers.clear();
    this.materials?.destroy?.();
    this.container.destroy({ children: true });
  }
}
