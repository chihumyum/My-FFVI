import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const objectKey = (o) => `${o.source.serializedFile}:${o.source.pathId}`;
const vec = (v, fallback = 0) => [v?.x ?? fallback, v?.y ?? fallback, v?.z ?? fallback];
const rgba = (v) => [v?.r ?? 1, v?.g ?? 1, v?.b ?? 1, v?.a ?? 1];
const finite = (v) => (Number.isFinite(v) ? v : 0);
const plainText = (value) =>
  String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\(FULL_SPACE\)/g, "　");
const matchText = (value) =>
  plainText(value)
    .replace(/[\s♪「」『』（）()…。、！？!?・▶]/g, "")
    .normalize("NFKC");
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let b = 0; b < 8; b++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function operaCrc32(value) {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(value, "utf8")) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Unity stores cubic coefficients at each streamed frame, not Hermite pairs. */
function animation(object, keyFor, properties) {
  const d = object.data,
    muscle = d.m_MuscleClip || {},
    data = muscle.m_Clip?.data || {};
  const stream = data.m_StreamedClip || {},
    words = stream.data || [],
    curves = Array.from({ length: stream.curveCount || 0 }, () => []);
  const floats = new Float32Array(new Uint32Array(words).buffer);
  for (let at = 0; at + 2 <= words.length;) {
    const time = floats[at++],
      count = words[at++];
    if (count > 100000 || at + count * 5 > words.length)
      throw new Error(`Invalid streamed frame in ${object.name}`);
    for (let n = 0; n < count; n++) {
      const index = words[at++],
        coeff = Array.from(floats.slice(at, at + 4));
      at += 4;
      if (index < curves.length && time !== Infinity)
        curves[index].push([Number.isFinite(time) ? time : -1e20, ...coeff.map(finite)]);
    }
  }
  const dense = data.m_DenseClip || {},
    constants = data.m_ConstantClip?.data || [],
    denseCount = dense.m_CurveCount || 0;
  const channels = [];
  let offset = 0;
  for (const binding of d.m_ClipBindingConstant?.genericBindings || []) {
    const size = binding.typeID === 4 ? [0, 3, 4, 3, 3][binding.attribute] || 1 : 1;
    channels.push({
      path: binding.path,
      type: binding.typeID,
      attribute: binding.attribute,
      custom: binding.customType,
      property:
        binding.typeID === 4
          ? { 1: "position", 2: "rotation", 3: "scale", 4: "euler" }[binding.attribute]
          : binding.isPPtrCurve
            ? "sprite"
            : properties.get(binding.attribute) || null,
      pointer: !!binding.isPPtrCurve,
      offset,
      size,
    });
    offset += size;
  }
  return {
    name: object.name,
    duration: muscle.m_StopTime || 0,
    sampleRate: d.m_SampleRate || 30,
    channels,
    stream: curves,
    dense: {
      count: denseCount,
      frames: dense.m_FrameCount || 0,
      rate: dense.m_SampleRate || 30,
      start: dense.m_BeginTime || 0,
      values: (dense.m_SampleArray || []).map(finite),
    },
    constants: constants.map(finite),
    pointers: (d.m_ClipBindingConstant?.pptrCurveMapping || []).map((ref) => keyFor(object, ref)),
    events: d.m_Events || [],
  };
}

/** Independent opera export. It consumes raw PR extraction and original meshes. */
export async function compileOpera(
  out = "build/web-data",
  { game = "build/runtime/game", python = ".venv/bin/python" } = {},
) {
  out = path.resolve(out);
  game = path.resolve(game);
  const [index, media] = await Promise.all([
    read(path.join(out, "raw/index.json")),
    read(path.join(out, "raw/media.json")),
  ]);
  const messages = await read(path.join(out, "raw/messages.json")),
    captions = {};
  for (const [id, ja] of Object.entries(messages.story_mes_ja?.values || {}))
    if (/^E(?:0315|0318|0330)_/.test(id))
      captions[id] = { ja: plainText(ja), zh: plainText(messages.story_mes_zhc?.values?.[id]) };
  const entries = index.files.filter((row) => /\/ff6_opera_/.test(row.file) && row.objectsOutput);
  const bundles = await Promise.all(
    entries.map(async (entry) => ({ entry, ...(await read(path.join(out, entry.objectsOutput))) })),
  );
  const objects = new Map(),
    external = new Map(),
    warnings = [];
  for (const bundle of bundles) {
    for (const o of bundle.objects) objects.set(objectKey(o), o);
    for (const [file, refs] of Object.entries(bundle.externalFiles)) external.set(file, refs);
  }
  const keyFor = (owner, ref) => {
    if (!ref?.m_PathID || ref.m_PathID === "0") return null;
    const file = ref.m_FileID
      ? path.posix.basename(
          external.get(owner.source.serializedFile)?.find((r) => r.fileId === ref.m_FileID)?.path ||
            "",
        )
      : owner.source.serializedFile;
    return file ? `${file}:${ref.m_PathID}` : null;
  };
  const get = (owner, ref) => objects.get(keyFor(owner, ref));
  const targetTextures = new Set(
    [...objects.values()]
      .filter((o) => o.type === "Camera")
      .map((o) => keyFor(o, o.data.m_TargetTexture))
      .filter(Boolean),
  );
  const mediaById = new Map(
    [...media.textures, ...media.sprites].map((row) => [objectKey(row), row]),
  );
  const images = {};
  const image = (key) => {
    const row = mediaById.get(key);
    if (!row?.url) return null;
    return (images[key] ??= {
      name: row.name,
      url: `/web-data/${row.displayUrl || row.url}`,
      width: row.width,
      height: row.height,
      pivot: row.pivot || [0.5, 0.5],
      ppu: row.pixelsPerUnit || 1,
      ...(row.mesh?.vertices?.length
        ? {
            mesh: {
              vertices: row.mesh.vertices,
              indices: row.mesh.triangles.flat(2),
              uv: row.mesh.vertices.map((v) => [
                (v[0] * (row.pixelsPerUnit || 1)) / row.width + (row.pivot?.[0] ?? 0.5),
                (v[1] * (row.pixelsPerUnit || 1)) / row.height + (row.pivot?.[1] ?? 0.5),
              ]),
            },
          }
        : {}),
    });
  };
  const properties = new Map(
    [
      "m_IsActive",
      "m_Enabled",
      "m_SortingOrder",
      "m_FlipX",
      "m_FlipY",
      "m_Color.r",
      "m_Color.g",
      "m_Color.b",
      "m_Color.a",
      "field of view",
      "orthographic size",
      "near clip plane",
      "far clip plane",
      "m_SizeDelta.x",
      "m_SizeDelta.y",
      "m_Alpha",
      "m_Intensity",
    ].map((s) => [operaCrc32(s), s]),
  );
  const materials = {};
  for (const o of objects.values())
    if (o.type === "Material") {
      const p = o.data.m_SavedProperties || {},
        floats = Object.fromEntries(p.m_Floats || []),
        colors = Object.fromEntries((p.m_Colors || []).map(([k, v]) => [k, rgba(v)])),
        textures = {};
      for (const key of [
        ...Object.keys(floats),
        ...Object.keys(colors).flatMap((k) => [k, ...["r", "g", "b", "a"].map((c) => `${k}.${c}`)]),
      ]) {
        properties.set(((operaCrc32(key) & 0x0fffffff) | 0x80000000) >>> 0, `material.${key}`);
      }
      for (const [name, t] of p.m_TexEnvs || []) {
        const key = keyFor(o, t.m_Texture),
          i = image(key);
        if (i || targetTextures.has(key))
          textures[name] = {
            ...(i || { renderTexture: key }),
            scale: vec(t.m_Scale, 1).slice(0, 2),
            offset: vec(t.m_Offset).slice(0, 2),
          };
      }
      const shader = get(o, o.data.m_Shader);
      materials[objectKey(o)] = {
        name: o.name,
        shader: shader?.name || "Last/LastEffectMaster",
        shaderSource: keyFor(o, o.data.m_Shader),
        renderQueue: o.data.m_CustomRenderQueue,
        floats,
        colors,
        textures,
        blendMode: floats._Subtract
          ? "subtract"
          : (floats._Dst ?? floats._DstBlend) === 1
            ? "add"
            : "normal",
      };
    }
  const animations = {};
  for (const o of objects.values())
    if (o.type === "AnimationClip") {
      const clip = animation(o, keyFor, properties);
      animations[objectKey(o)] = clip;
      for (const key of clip.pointers) image(key);
    }
  const scenes = {};
  for (const bundle of bundles) {
    const id = path.basename(bundle.entry.file).split("_assets_")[0].replace("ff6_opera_", "");
    const transforms = bundle.objects.filter((o) =>
      ["Transform", "RectTransform"].includes(o.type),
    );
    const nodes = [],
      byTransform = new Map(),
      byGo = new Map(),
      components = new Map();
    for (const o of bundle.objects) {
      const key = keyFor(o, o.data.m_GameObject);
      if (key) {
        if (!components.has(key)) components.set(key, []);
        components.get(key).push(o);
      }
    }
    for (const o of transforms) {
      const go = get(o, o.data.m_GameObject);
      if (!go) continue;
      const n = {
        id: nodes.length,
        key: objectKey(o),
        name: go.name,
        parent: null,
        position: vec(o.data.m_LocalPosition),
        rotation: [...vec(o.data.m_LocalRotation), o.data.m_LocalRotation?.w ?? 1],
        scale: vec(o.data.m_LocalScale, 1),
        active: go.data.m_IsActive !== false,
        layer: go.data.m_Layer || 0,
        ...(o.type === "RectTransform"
          ? {
              rect: {
                anchorMin: vec(o.data.m_AnchorMin).slice(0, 2),
                anchorMax: vec(o.data.m_AnchorMax).slice(0, 2),
                pivot: vec(o.data.m_Pivot).slice(0, 2),
                size: vec(o.data.m_SizeDelta).slice(0, 2),
                anchored: vec(o.data.m_AnchoredPosition).slice(0, 2),
              },
            }
          : {}),
      };
      nodes.push(n);
      byTransform.set(objectKey(o), n.id);
      byGo.set(objectKey(go), n.id);
    }
    for (const o of transforms) {
      const n = nodes[byTransform.get(objectKey(o))];
      if (n) n.parent = byTransform.get(keyFor(o, o.data.m_Father)) ?? null;
    }
    const nodeFor = (o, ref) => {
      const v = get(o, ref);
      return v
        ? (byTransform.get(objectKey(v)) ??
            byGo.get(v.type === "GameObject" ? objectKey(v) : keyFor(v, v.data.m_GameObject)) ??
            null)
        : null;
    };
    const renderers = [],
      cameras = [],
      directors = [],
      texts = [],
      canvases = [];
    for (const o of bundle.objects) {
      const d = o.data,
        node = byGo.get(keyFor(o, d.m_GameObject));
      if (node === undefined) continue;
      if (o.class === "Text") {
        const normalized = matchText(d.m_Text),
          prefix = { stage_event: "E0315_", opera_event: "E0318_", dance_stage: "E0330_" }[id];
        texts.push({
          node,
          text: d.m_Text,
          enabled: !!d.m_Enabled,
          color: rgba(d.m_Color),
          fontSize: d.m_FontData?.m_FontSize || 48,
          alignment: d.m_FontData?.m_Alignment || 0,
          captions:
            normalized.length >= 3 || (normalized.length >= 2 && /♪/.test(d.m_Text))
              ? Object.entries(captions)
                  .filter(
                    ([key, value]) =>
                      key.startsWith(prefix) &&
                      matchText(value.ja).includes(normalized) &&
                      (!/♪/.test(d.m_Text) || /♪/.test(value.ja)),
                  )
                  .map(([key]) => key)
              : [],
        });
      }
      if (o.type === "Canvas") {
        const scaler = (components.get(keyFor(o, d.m_GameObject)) || []).find(
          (c) => c.class === "CanvasScaler",
        );
        canvases.push({
          node,
          enabled: !!d.m_Enabled,
          mode: d.m_RenderMode,
          reference: vec(scaler?.data.m_ReferenceResolution).slice(0, 2),
        });
      }
      if (["SpriteRenderer", "MeshRenderer", "SkinnedMeshRenderer"].includes(o.type)) {
        const group = components.get(keyFor(o, d.m_GameObject)) || [],
          meshFilter = group.find((c) => c.type === "MeshFilter");
        const sprite = keyFor(o, d.m_Sprite);
        image(sprite);
        renderers.push({
          node,
          type: o.type,
          enabled: d.m_Enabled !== false,
          order: d.m_SortingOrder || 0,
          sortingLayer: d.m_SortingLayer || 0,
          sprite,
          color: rgba(d.m_Color),
          flipX: !!d.m_FlipX,
          flipY: !!d.m_FlipY,
          materials: (d.m_Materials || []).map((ref) => keyFor(o, ref)),
          mesh: keyFor(o, d.m_Mesh) || (meshFilter && keyFor(meshFilter, meshFilter.data.m_Mesh)),
          bones: (d.m_Bones || []).map((ref) => nodeFor(o, ref)),
        });
      }
      if (o.type === "Camera")
        cameras.push({
          node,
          enabled: !!d.m_Enabled,
          fov: d["field of view"],
          orthographic: !!d.orthographic,
          size: d["orthographic size"],
          near: d["near clip plane"],
          far: d["far clip plane"],
          depth: d.m_Depth || 0,
          viewport: d.m_NormalizedViewPortRect,
          mask: d.m_CullingMask?.m_Bits ?? 0xffffffff,
          targetTexture: keyFor(o, d.m_TargetTexture),
          background: rgba(d.m_BackGroundColor),
        });
      if (o.type === "PlayableDirector")
        directors.push({
          node,
          timeline: keyFor(o, d.m_PlayableAsset),
          bindings: new Map(
            (d.m_SceneBindings || []).map((b) => [keyFor(o, b.key), nodeFor(o, b.value)]),
          ),
        });
    }
    const descendants = (root) =>
      nodes.filter((n) => {
        let p = n.id;
        while (p !== null) {
          if (p === root) return true;
          p = nodes[p]?.parent ?? null;
        }
        return false;
      });
    const hashes = (root) =>
      new Map(
        descendants(root).map((node) => {
          const names = [];
          let n = node;
          while (n.id !== root) {
            names.unshift(n.name);
            n = nodes[n.parent];
          }
          return [operaCrc32(names.join("/")), node.id];
        }),
      );
    const hashCache = new Map(),
      hashesFor = (root) => {
        if (!hashCache.has(root)) hashCache.set(root, hashes(root));
        return hashCache.get(root);
      };
    const timelineObjects = bundle.objects.filter((o) => o.class === "TimelineAsset"),
      timelines = {};
    for (const t of timelineObjects) {
      const director = directors.find((d) => d.timeline === objectKey(t)),
        tracks = [];
      const addTrack = (track) => {
        if (!track) return;
        for (const ref of track.data.m_Children || []) addTrack(get(track, ref));
        if (!track.data.m_Clips?.length) return;
        const clips = track.data.m_Clips.map((c) => {
          const playable = get(track, c.m_Asset),
            clipKey = playable && keyFor(playable, playable.data.m_Clip);
          return {
            name: c.m_DisplayName,
            start: c.m_Start,
            duration: c.m_Duration,
            in: c.m_ClipIn || 0,
            speed: c.m_TimeScale || 1,
            animation: animations[clipKey] ? clipKey : null,
            audio: track.class === "AudioTrack" ? c.m_DisplayName : null,
            loop: playable?.data.m_Loop === 1,
            pre: c.m_PreExtrapolationMode,
            post: c.m_PostExtrapolationMode,
            offset: vec(playable?.data.m_Position),
            rotation: vec(playable?.data.m_EulerAngles),
          };
        });
        let root = director?.bindings.get(objectKey(track)) ?? null;
        const clip = clips.find((c) => c.animation),
          animation = animations[clip?.animation];
        if (root === null && animation) {
          const name = animation.name
            .replace(/^A_/, "")
            .replace(/^DS_ALL_/, "DS_")
            .replace(/^SDS_ALL_/, "SDS_");
          const candidates = nodes.filter(
            (n) => n.name === name || n.name === name.replace(/_/g, "") || n.parent === null,
          );
          const scored = candidates
            .map((n) => ({
              root: n.id,
              score: animation.channels.filter((c) => hashesFor(n.id).has(c.path)).length,
            }))
            .sort((a, b) => b.score - a.score);
          root = scored[0]?.root ?? null;
        }
        if (root === null && track.class === "ActivationTrack") {
          const n = tracks.length;
          // Unbound master activation tracks parallel the following animation track.
          root =
            nodes.find(
              (node) => node.name === `ALL_ROOT${String(Math.floor(n / 2)).padStart(2, "0")}`,
            )?.id ?? null;
        }
        for (const c of clips)
          if (c.animation && root !== null)
            c.bindings = animations[c.animation].channels.map(
              (b) => hashesFor(root).get(b.path) ?? null,
            );
        tracks.push({
          name: track.name,
          type: track.class,
          muted: !!track.data.m_Muted,
          root,
          clips,
        });
      };
      for (const ref of t.data.m_Tracks || []) addTrack(get(t, ref));
      // The original unbound master assets alternate activation/animation.
      // Their adjacent animation's resolved hierarchy is a stronger binding
      // than a guessed ordinal prefab name.
      for (let n = 0; n < tracks.length; n++)
        if (tracks[n].type === "ActivationTrack" && !director?.bindings.size)
          tracks[n].root =
            tracks.slice(n + 1).find((track) => track.type === "AnimationTrack")?.root ??
            tracks[n].root;
      timelines[t.name] = {
        name: t.name,
        source: objectKey(t),
        root: director?.node ?? null,
        tracks,
        duration: Math.max(0, ...tracks.flatMap((tr) => tr.clips.map((c) => c.start + c.duration))),
        visualDuration: Math.max(
          0,
          ...tracks
            .filter((tr) => tr.type !== "AudioTrack")
            .flatMap((tr) => tr.clips.map((c) => c.start + c.duration)),
        ),
      };
    }
    scenes[id] = {
      name: id,
      nodes,
      renderers,
      cameras,
      timelines,
      texts,
      canvases,
      source: bundle.entry.file,
      particles: bundle.objects.filter((o) => o.type === "ParticleSystem").length,
      cloth: bundle.entry.counts.Cloth || 0,
    };
  }
  const stage = scenes.stage_event.timelines.ALL_ROOT_AllTimeline,
    aria = scenes.opera_event.timelines.ALL_ROOTTimeline,
    dance = scenes.dance_stage.timelines.DS_ROOT_AllTimeline;
  const split =
    stage.tracks.find((tr) => tr.clips.some((c) => c.name === "A_ALL_ROOT_05"))?.clips[0].start ||
    111.7333333333333;
  const ariaEnd =
    aria.tracks.flatMap((tr) => tr.clips).find((c) => c.name === "SDS_ALL_ROOT_00")?.start ||
    aria.visualDuration;
  const stages = {
    100: {
      scene: "stage_event",
      timeline: stage.name,
      start: 0,
      end: split,
      title: "序幕",
      sourceScript: "sc_e_0315_1",
    },
    101: {
      scene: "stage_event",
      timeline: stage.name,
      start: split,
      end: stage.visualDuration,
      title: "序幕续场",
      sourceScript: "sc_e_0315_3",
    },
    200: {
      scene: "opera_event",
      timeline: aria.name,
      start: 0,
      end: Math.min(ariaEnd, 239.6),
      title: "玛丽亚与德拉科",
      sourceScript: "sc_e_0318_1",
    },
    301: {
      scene: "dance_stage",
      timeline: dance.name,
      start: 0,
      end: dance.visualDuration,
      title: "婚礼华尔兹",
      sourceScript: "sc_e_0330_1",
    },
  };
  const audioCatalog = await read(path.join(out, "audio.json")).catch(() => ({
      bgm: { tracks: {} },
    })),
    audio = {};
  for (const scene of Object.values(scenes))
    for (const timeline of Object.values(scene.timelines))
      for (const track of timeline.tracks)
        for (const clip of track.clips) {
          if (!clip.audio || audio[clip.audio]) continue;
          const asset = clip.audio.match(/^BGM_FF6_(\d+[a-z]?)/i)?.[1];
          if (!asset) continue;
          const rows = Object.entries(audioCatalog.bgm.tracks).filter(([, row]) =>
            new RegExp(`^SWAV_BGM_FF6_${asset}(?:_[A-Z]{3})?\\.mab$`, "i").test(row.assetName),
          );
          const variants = {};
          for (const [id, row] of rows) {
            const language = row.assetName.match(/_([A-Z]{3})\.mab$/)?.[1] || "default";
            variants[language] = {
              bankId: Number(id),
              url: row.file,
              duration: row.durationSeconds,
            };
          }
          audio[clip.audio] = { name: clip.audio, variants };
        }
  warnings.push(
    "Stage 100/101 are mapped to the StageEvent master around its authored A_ALL_ROOT_05 cut (111.733s), matching the intervening dressing-room source script. The native numeric selector-to-prefab lookup is not serialized; this split is inferred.",
    "Stage 200 uses OperaEvent's aria cuts before SDS_ALL_ROOT_00; stage 301 uses DanceStage's visual master. Trailing editor music spans are excluded from visual playback; native interactive timing/choice branches are not reproduced by this presentation player.",
    "Original mesh vertices, sprite triangulation, UVs, hierarchical transforms, sprite swaps, activation curves, camera projection, and authored clip times are retained. Authored depth-tested geometry uses far-to-near painter order, with original Shader queue/ZTest/ZWrite retained; overlays keep source sorting order. This is a source-state approximation, not native per-pixel depth-buffer/custom opera Shader occlusion. Perspective UV correction, lighting, cloth simulation and unsupported material properties remain approximate.",
    "If several authored output cameras are enabled together, the web player selects one by visible-object origin score and camera depth; this selector is inferred rather than the native camera compositing graph. Offstage effect-camera transforms are retained instead of recentering them on an actor.",
    "Opera particle systems and nested AnimatorController state machines are counted but not simulated here. Authored timeline sprite/transform animation still plays; cloth/skinned meshes initially use their exported rest geometry unless skin weights are usable.",
    "Timeline editor audio display names are matched to exported PR BGM bank asset names (32a/b/c, 33, 34b/c/d). The caller selects a supplied language variant; unsupported placeholder BGM_Cxx editor clips have no invented audio. Source timeline timing is kept even where an editor placeholder duration differs from the shipping bank.",
    "Visible authored Japanese Text fragments select the matching original story_mes_zhc caption by the same PR message ID. The web subtitle box uses a compact layout instead of the native Canvas/FontSelector layout and karaoke highlighting. Unmatched editor Text remains Japanese; native-generated subtitle cues absent from these timelines remain unavailable.",
  );
  const unknown = [
    ...new Set(
      Object.values(animations).flatMap((a) =>
        a.channels.filter((c) => !c.property).map((c) => `${c.type}:${c.attribute}`),
      ),
    ),
  ];
  if (unknown.length)
    warnings.push(
      `Unresolved animated property bindings retained without visual execution: ${unknown.join(", ")}.`,
    );
  await mkdir(path.join(out, "opera"), { recursive: true });
  const meshResult = await promisify(execFile)(
    python,
    [path.join(import.meta.dirname, "opera_meshes.py"), "--game", game, "--out", out],
    { maxBuffer: 4e6 },
  );
  const meshData = await read(path.join(out, "opera/meshes.json"));
  const queueBases = {
    Background: 1000,
    Geometry: 2000,
    AlphaTest: 2450,
    Transparent: 3000,
    Overlay: 4000,
  };
  for (const material of Object.values(materials)) {
    const shader = meshData.shaders[material.shaderSource];
    if (shader) {
      material.shader = shader.name || material.shader;
      const queue = shader.queue?.match(/^(\w+)([+-]\d+)?$/),
        value = (state) =>
          state?.name && state.name !== "<noninit>"
            ? (material.floats[state.name] ?? state.val)
            : state?.val;
      if (!(material.renderQueue >= 0))
        material.renderQueue = queue
          ? (queueBases[queue[1]] ?? 2000) + Number(queue[2] || 0)
          : 2000;
      material.depthTest = value(shader.zTest);
      material.depthWrite = value(shader.zWrite);
      material.renderType = shader.renderType;
    }
    for (const texture of Object.values(material.textures))
      if (texture.renderTexture)
        Object.assign(texture, meshData.renderTextures[texture.renderTexture]);
  }
  warnings.push(...meshData.warnings);
  const usedMeshes = new Set(
    Object.values(scenes)
      .flatMap((s) => s.renderers.map((r) => r.mesh))
      .filter(Boolean),
  );
  const meshes = Object.fromEntries(
    [...usedMeshes].filter((key) => meshData.meshes[key]).map((key) => [key, meshData.meshes[key]]),
  );
  const missing = [...usedMeshes].filter((key) => !meshes[key]);
  if (missing.length) warnings.push(`Unresolved original mesh references: ${missing.join(", ")}.`);
  const summary = {
    scenes: Object.keys(scenes).length,
    nodes: Object.values(scenes).reduce((n, s) => n + s.nodes.length, 0),
    animations: Object.keys(animations).length,
    timelines: Object.values(scenes).reduce((n, s) => n + Object.keys(s.timelines).length, 0),
    meshes: Object.keys(meshes).length,
    images: Object.keys(images).length,
  };
  const result = {
    version: 1,
    stages,
    scenes,
    animations,
    materials,
    images,
    meshes,
    renderTextures: meshData.renderTextures,
    audio,
    captions,
    warnings,
    summary,
  };
  await writeFile(path.join(out, "opera.json"), JSON.stringify(result) + "\n");
  console.log("Opera presentation", summary, meshResult.stdout.trim());
  return result;
}

if (process.argv[1] === import.meta.filename)
  await compileOpera(process.argv[2], {
    game: process.argv[3] || "build/runtime/game",
    python: process.env.PYTHON || ".venv/bin/python",
  });
