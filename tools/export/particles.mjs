import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const objectKey = (source) => `${source.serializedFile}:${source.pathId}`;
const vec = (value, fallback = 0) => [
  value?.x ?? fallback,
  value?.y ?? fallback,
  value?.z ?? fallback,
];
const rgba = (value) => [value?.r ?? 1, value?.g ?? 1, value?.b ?? 1, value?.a ?? 1];
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

// Unity MinMaxCurve modes: Constant, Curve, TwoCurves, TwoConstants. Tangents
// are kept for cubic Hermite evaluation; weighted handles are not discarded.
function curveKeys(value) {
  return (Array.isArray(value?.m_Curve) ? value.m_Curve : []).map((key) => [
    key.time,
    key.value,
    finite(key.inSlope),
    finite(key.outSlope),
    key.weightedMode || 0,
    key.inWeight || 0,
    key.outWeight || 0,
    !Number.isFinite(key.inSlope) ? 1 : 0,
    !Number.isFinite(key.outSlope) ? 1 : 0,
  ]);
}
function curve(value, fallback = 0) {
  if (!value) return { mode: 0, max: fallback };
  const mode = value.minMaxState || 0;
  return {
    mode,
    max: finite(value.scalar, fallback),
    ...(mode >= 2 ? { min: finite(value.minScalar, fallback) } : {}),
    ...(mode === 1 || mode === 2
      ? {
          keys: curveKeys(value.maxCurve),
          pre: value.maxCurve?.m_PreInfinity,
          post: value.maxCurve?.m_PostInfinity,
        }
      : {}),
    ...(mode === 2 ? { minKeys: curveKeys(value.minCurve) } : {}),
  };
}
function gradientKeys(value) {
  const colors = [],
    alpha = [];
  for (let n = 0; n < (value?.m_NumColorKeys || 0); n++)
    colors.push([value[`ctime${n}`] / 65535, ...rgba(value[`key${n}`]).slice(0, 3)]);
  for (let n = 0; n < (value?.m_NumAlphaKeys || 0); n++)
    alpha.push([value[`atime${n}`] / 65535, value[`key${n}`]?.a ?? 1]);
  return { colors, alpha, fixed: value?.m_Mode === 1 };
}
function gradient(value) {
  if (!value) return { mode: 0, max: [1, 1, 1, 1] };
  const mode = value.minMaxState || 0;
  return {
    mode,
    max: rgba(value.maxColor),
    ...(mode >= 2 ? { min: rgba(value.minColor) } : {}),
    ...([1, 3, 4].includes(mode) ? { keys: gradientKeys(value.maxGradient) } : {}),
    ...(mode === 3 ? { minKeys: gradientKeys(value.minGradient) } : {}),
  };
}
function convert(value) {
  if (!value || typeof value !== "object") return value;
  if (Object.hasOwn(value, "minMaxState"))
    return Object.hasOwn(value, "scalar") ? curve(value) : gradient(value);
  if (Array.isArray(value)) return value.map(convert);
  if (Object.hasOwn(value, "$unityFloat")) return 0;
  if (Array.isArray(value.m_Curve))
    return { keys: curveKeys(value), pre: value.m_PreInfinity, post: value.m_PostInfinity };
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, convert(child)]));
}

export async function compileParticles(out) {
  out = path.resolve(out);
  const started = Date.now();
  const [index, media, tables] = await Promise.all(
    ["raw/index.json", "raw/media.json", "raw/tables.json"].map((file) =>
      read(path.join(out, file)),
    ),
  );
  const sources = index.files.filter(
    (row) => /\/ef_ff[01456]_/.test(row.file) && row.objectsOutput,
  );
  const mediaById = new Map(
    [...media.textures, ...media.sprites].map((row) => [objectKey(row.source), row]),
  );
  // Materials may be external to an effect bundle (e.g. shared Blitz effects).
  // Resolve their own external-file table, rather than reusing the caller's.
  const sharedMaterials = new Map(),
    externalByFile = new Map();
  for (const source of index.files.filter((row) => row.counts?.Material && row.objectsOutput)) {
    const metadata = await read(path.join(out, source.objectsOutput));
    for (const [file, entries] of Object.entries(metadata.externalFiles))
      externalByFile.set(file, entries);
    for (const object of metadata.objects)
      if (object.type === "Material") sharedMaterials.set(objectKey(object.source), object);
  }
  const effects = {},
    warnings = [],
    modules = {},
    familyCounts = {},
    rendererModes = {};
  let serializedSystems = 0,
    selectedSystems = 0,
    nodesCount = 0;
  const textureURLs = new Set();
  for (const source of sources) {
    const bundle = await read(path.join(out, source.objectsOutput));
    const name = path.basename(source.file).split("_assets_")[0];
    const family = name.match(/^ef_ff\d+/)[0];
    familyCounts[family] = (familyCounts[family] || 0) + 1;
    const objects = new Map(bundle.objects.map((row) => [objectKey(row.source), row]));
    const keyFor = (owner, ref) => {
      if (!ref?.m_PathID || ref.m_PathID === "0") return null;
      let file = owner.source.serializedFile;
      if (ref.m_FileID) {
        const external = (externalByFile.get(file) || bundle.externalFiles[file])?.find(
          (entry) => entry.fileId === ref.m_FileID,
        );
        if (!external) return null;
        file = path.posix.basename(external.path);
      }
      return `${file}:${ref.m_PathID}`;
    };
    const get = (owner, ref) =>
      objects.get(keyFor(owner, ref)) || sharedMaterials.get(keyFor(owner, ref));
    const components = new Map(),
      transforms = new Map();
    for (const object of bundle.objects) {
      const owner = keyFor(object, object.data.m_GameObject);
      if (!owner) continue;
      if (object.type === "Transform") transforms.set(owner, object);
      if (!components.has(owner)) components.set(owner, []);
      components.get(owner).push(object);
    }
    const nodeIds = new Map(),
      nodes = [],
      systems = [],
      sprites = [],
      materials = {};
    const warning = (system, module, reason) =>
      warnings.push({ effect: name, system, module, reason });
    const roots = bundle.objects.filter(
      (row) => row.type === "GameObject" && row.name === "EffectPrefab",
    );
    if (roots.length !== 1)
      warning(
        null,
        "hierarchy",
        `${roots.length} EffectPrefab roots; the first available authored root is used.`,
      );
    const root = roots[0];
    function addNode(transform, parent = null) {
      if (!transform || nodeIds.has(objectKey(transform.source))) return;
      const go = get(transform, transform.data.m_GameObject);
      const id = nodes.length;
      nodeIds.set(objectKey(transform.source), id);
      const d = transform.data;
      const list = components.get(objectKey(go.source)) || [];
      const positionInfo = list.find((row) => row.class === "EffectPositionInfo");
      const reactions = list
        .filter((row) => row.class === "EffectReactionInspector")
        .map((row) => ({ type: row.data.currentType, property: convert(row.data.effectProperty) }));
      if (reactions.length)
        warning(
          go.name,
          "EffectReactionInspector",
          `Custom reaction types ${[...new Set(reactions.map((r) => r.type))].join(",")} are retained; shader/actor/camera reactions require presentation adapters.`,
        );
      if (list.some((row) => row.type === "Animator"))
        warning(
          go.name,
          "Animator",
          "Authored Animator is retained by reference; this particle player does not execute Unity animation clips.",
        );
      nodes.push({
        name: go.name,
        parent,
        active: go.data.m_IsActive !== false,
        position: vec(d.m_LocalPosition),
        rotation: [...vec(d.m_LocalRotation), d.m_LocalRotation?.w ?? 1],
        scale: vec(d.m_LocalScale, 1),
        ...(positionInfo
          ? {
              placement: convert(
                Object.fromEntries(
                  Object.entries(positionInfo.data).filter(([key]) => !key.startsWith("m_")),
                ),
              ),
            }
          : {}),
        ...(reactions.length ? { reactions } : {}),
      });
      for (const child of d.m_Children || []) addNode(get(transform, child), id);
    }
    if (root) addNode(transforms.get(objectKey(root.source)));
    if (!nodes.length) {
      for (const transform of transforms.values())
        if (transform.data.m_Father?.m_PathID === "0") addNode(transform);
      warning(
        null,
        "hierarchy",
        "No EffectPrefab hierarchy; all top-level authored nodes retained.",
      );
    }
    function texture(owner, pointer) {
      const row = mediaById.get(keyFor(owner, pointer));
      const url = row?.displayUrl || row?.url;
      if (!url) return null;
      const value = { url: `/web-data/${url}`, width: row.width, height: row.height };
      textureURLs.add(value.url);
      return value;
    }
    function material(owner, pointer) {
      if (!keyFor(owner, pointer)) return null;
      const object = get(owner, pointer);
      if (!object) {
        warning(
          owner.name,
          "Material",
          `Unresolved material ${keyFor(owner, pointer)}; white fallback is explicit.`,
        );
        return null;
      }
      const id = objectKey(object.source);
      if (materials[id]) return id;
      const p = object.data.m_SavedProperties || {},
        floats = Object.fromEntries(p.m_Floats || []),
        colors = Object.fromEntries(p.m_Colors || []),
        textures = {};
      for (const [key, value] of p.m_TexEnvs || []) {
        const image = texture(object, value.m_Texture);
        if (image)
          textures[key] = {
            ...image,
            scale: vec(value.m_Scale, 1).slice(0, 2),
            offset: vec(value.m_Offset).slice(0, 2),
          };
      }
      const src = floats._Src ?? floats._SrcBlend ?? 5,
        dst = floats._Dst ?? floats._DstBlend ?? 10;
      let blendMode;
      if (floats._Subtract) blendMode = "subtract";
      else if (dst === 1 && [1, 5].includes(src)) blendMode = "add";
      else if ((src === 0 && dst === 3) || (src === 2 && dst === 0)) blendMode = "multiply";
      else if ((src === 1 && dst === 6) || (src === 4 && dst === 1)) blendMode = "screen";
      else if ([1, 5].includes(src) && dst === 10) blendMode = "normal";
      else if (src === 1 && dst === 0) blendMode = "normal";
      else {
        blendMode = "normal";
        warning(object.name, "blend", `Unity blend (${src},${dst}) approximated by normal alpha.`);
      }
      materials[id] = {
        name: object.name,
        textures,
        blendMode,
        sourceBlend: [src, dst],
        color: rgba(colors._Color || colors._TintColor),
        floats,
        colors: Object.fromEntries(
          Object.entries(colors).map(([key, value]) => [key, rgba(value)]),
        ),
        keywords: object.data.m_ShaderKeywords || "",
      };
      const features = [
        "_UseGradient",
        "_UseNoise",
        "_UseMask",
        "_UseRamp",
        "_Dissolve",
        "_Polar",
        "_Pixelate",
        "_BaseToAlpha",
        "_AlphaEdge",
      ].filter((key) => floats[key]);
      if (features.length)
        warning(
          object.name,
          "shader",
          `Custom material features ${features.join(",")} retained; Sprite tint uses gradient white endpoint when present, not the original shader.`,
        );
      if (!textures._MainTex)
        warning(
          object.name,
          "texture",
          "Material has no resolvable MainTex; white fallback will be used.",
        );
      if (
        textures._MainTex &&
        (textures._MainTex.scale.some((v) => v !== 1) || textures._MainTex.offset.some(Boolean))
      )
        warning(
          object.name,
          "textureTransform",
          "MainTex repeat/offset is retained but the Sprite adapter uses the original texture canvas.",
        );
      return id;
    }
    const psIds = new Map();
    for (const object of bundle.objects.filter((row) => row.type === "ParticleSystem")) {
      serializedSystems++;
      const transform = transforms.get(keyFor(object, object.data.m_GameObject));
      const node = transform && nodeIds.get(objectKey(transform.source));
      if (node === undefined) continue;
      psIds.set(objectKey(object.source), systems.length);
      const go = get(object, object.data.m_GameObject),
        renderer = (components.get(objectKey(go.source)) || []).find(
          (row) => row.type === "ParticleSystemRenderer",
        );
      const d = object.data,
        r = renderer?.data || {};
      const initial = d.InitialModule || {};
      const row = {
        node,
        name: go.name,
        duration: d.lengthInSec,
        speed: d.simulationSpeed,
        looping: d.looping,
        prewarm: d.prewarm,
        playOnAwake: d.playOnAwake,
        space: d.moveWithTransform,
        scalingMode: d.scalingMode,
        startDelay: curve(d.startDelay),
        initial: {
          lifetime: curve(initial.startLifetime, 5),
          speed: curve(initial.startSpeed),
          color: gradient(initial.startColor),
          size: curve(initial.startSize, 1),
          sizeY: curve(initial.startSizeY, 1),
          sizeZ: curve(initial.startSizeZ, 1),
          size3D: initial.size3D,
          rotation: curve(initial.startRotation),
          rotationX: curve(initial.startRotationX),
          rotationY: curve(initial.startRotationY),
          rotation3D: initial.rotation3D,
          rotationFlip: initial.randomizeRotationDirection,
          gravity: curve(initial.gravityModifier),
          maxParticles: initial.maxNumParticles,
        },
        renderer: {
          enabled: r.m_Enabled !== false,
          mode: r.m_RenderMode || 0,
          alignment: r.m_RenderAlignment,
          sortingOrder: r.m_SortingOrder || 0,
          lengthScale: r.m_LengthScale,
          velocityScale: r.m_VelocityScale,
          pivot: vec(r.m_Pivot),
          flip: vec(r.m_Flip),
          material: r.m_Materials?.[0] ? material(renderer, r.m_Materials[0]) : null,
          trailMaterial:
            d.TrailModule?.enabled && r.m_Materials?.[1]
              ? material(renderer, r.m_Materials[1])
              : null,
        },
        modules: {},
      };
      rendererModes[row.renderer.mode] = (rendererModes[row.renderer.mode] || 0) + 1;
      if (row.renderer.mode === 4)
        warning(
          go.name,
          "renderer",
          "Mesh particles projected to textured billboard sprites; original mesh silhouette is not reproduced.",
        );
      if (row.renderer.mode === 3)
        warning(
          go.name,
          "renderer",
          "Vertical billboard projected onto the orthographic XY plane.",
        );
      if (d.prewarm)
        warning(
          go.name,
          "prewarm",
          "Prewarm is bounded to one simulation duration in the presentation player.",
        );
      if (initial.rotation3D)
        warning(
          go.name,
          "rotation3D",
          "Start XY rotation is retained; billboard silhouettes use projected node rotation and particle Z rotation.",
        );
      if (d.scalingMode !== 0)
        warning(
          go.name,
          "scalingMode",
          `Scaling mode ${d.scalingMode} retained; Sprite dimensions currently use hierarchy scale.`,
        );
      for (const [key, value] of Object.entries(d))
        if (key.endsWith("Module") && key !== "InitialModule" && value?.enabled) {
          modules[key] = (modules[key] || 0) + 1;
          row.modules[key] = convert(value);
          if (
            ["NoiseModule", "CollisionModule", "TrailModule", "InheritVelocityModule"].includes(key)
          )
            warning(
              go.name,
              key,
              {
                NoiseModule:
                  "Unity Perlin noise is approximated by deterministic smooth sine noise.",
                CollisionModule:
                  "Collision planes are retained but are not game physics; particles continue without collisions.",
                TrailModule:
                  "Trails are approximated by faded sprite history, without ribbon mesh joins.",
                InheritVelocityModule:
                  "Inherits tracked presentation origin velocity; no Rigidbody simulation.",
              }[key],
            );
          if (key === "ShapeModule" && [6, 13, 14, 19, 20].includes(value.type))
            warning(
              go.name,
              key,
              `Shape ${value.type} mesh/sprite surface approximated by its projected radius.`,
            );
        }
      if (row.modules.UVModule?.mode === 1)
        row.modules.UVModule.sprites = (d.UVModule.sprites || [])
          .map((entry) => texture(object, entry.sprite))
          .filter(Boolean);
      systems.push(row);
    }
    for (const object of bundle.objects.filter((row) => row.type === "ParticleSystem")) {
      const id = psIds.get(objectKey(object.source));
      if (id === undefined || !object.data.SubModule?.enabled) continue;
      systems[id].modules.SubModule.subEmitters = object.data.SubModule.subEmitters.map(
        (entry) => ({
          type: entry.type,
          properties: entry.properties,
          probability: entry.emitProbability,
          system: psIds.get(keyFor(object, entry.emitter)) ?? null,
        }),
      );
    }
    for (const object of bundle.objects.filter((row) => row.type === "SpriteRenderer")) {
      const transform = transforms.get(keyFor(object, object.data.m_GameObject)),
        node = transform && nodeIds.get(objectKey(transform.source));
      if (node === undefined) continue;
      const image = texture(object, object.data.m_Sprite);
      if (!image) {
        warning(
          nodes[node].name,
          "SpriteRenderer",
          "Sprite PPtr is missing from exported media; no substitute image was invented.",
        );
        continue;
      }
      sprites.push({
        node,
        texture: image,
        color: rgba(object.data.m_Color),
        flipX: object.data.m_FlipX,
        flipY: object.data.m_FlipY,
        enabled: object.data.m_Enabled !== false,
        sortingOrder: object.data.m_SortingOrder || 0,
      });
    }
    const prefabRoots = [...transforms.entries()]
      .filter(([, row]) => row.data.m_Father?.m_PathID === "0")
      .map(([, row]) => get(row, row.data.m_GameObject)?.name)
      .filter(Boolean);
    effects[name] = { nodes, systems, sprites, materials, prefabRoots };
    selectedSystems += systems.length;
    nodesCount += nodes.length;
  }
  const effectIds = {};
  for (const row of tables["battle_effect_asset.csv"] || []) {
    const asset = row.asset_name.trim().toLowerCase();
    effectIds[row.id.trim()] = {
      asset,
      positionType: Number(row.position_type),
      displayType: Number(row.display_type),
      se: [row.se_asset_id, row.se_asset_id_2].map(Number).filter(Boolean),
      criticalSE: Number(row.critical_se_asset_id),
    };
    if (!effects[asset])
      warnings.push({
        effect: asset,
        module: "asset",
        reason: `battle_effect_asset ${row.id} does not resolve to an exported ef_ff0/1/4/5/6 package.`,
      });
  }
  const mapping = (name) =>
    Object.fromEntries(
      (tables[`${name}.csv`] || [])
        .filter((row) => Number(row.battle_effect_asset_id) > 0)
        .map((row) => [row.id.trim(), Number(row.battle_effect_asset_id)]),
    );
  const summary = {
    packages: sources.length,
    families: familyCounts,
    serializedSystems,
    systems: selectedSystems,
    nodes: nodesCount,
    materials: Object.values(effects).reduce((n, fx) => n + Object.keys(fx.materials).length, 0),
    textures: textureURLs.size,
    modules,
    rendererModes,
    warnings: warnings.length,
    warningModules: warnings.reduce(
      (counts, row) => ((counts[row.module] = (counts[row.module] || 0) + 1), counts),
      {},
    ),
    seconds: (Date.now() - started) / 1000,
  };
  const result = {
    version: 1,
    coordinateSystem:
      "Unity XYZ, quaternion XYZW; presentation projects XY with inverted Y at 1 Unity unit per logical pixel.",
    effects,
    effectIds,
    abilities: mapping("ability"),
    weapons: mapping("weapon"),
    items: mapping("item"),
    warnings,
    summary,
  };
  for (const url of textureURLs) await stat(path.join(out, url.replace(/^\/web-data\//, "")));
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "particles.json"), JSON.stringify(result) + "\n");
  console.log(
    JSON.stringify({ ...summary, bytes: (await stat(path.join(out, "particles.json"))).size }),
  );
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    index = args.indexOf("--data");
  await compileParticles(index >= 0 ? args[index + 1] : "build/web-data");
}
