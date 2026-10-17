import { readFile, writeFile, mkdir, readdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

const project = path.resolve(import.meta.dirname, "../..");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const key = (source) => `${source.serializedFile}::${source.pathId}`;
const vector = (value, fallback = 0) => [value?.x ?? fallback, value?.y ?? fallback];
const webURL = (file) => `/web-data/${file}`;
const NOTO_WOFF2 =
  "https://fonts.gstatic.com/s/notosanssc/v41/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYk.woff2";
const NOTO_TTF =
  "https://fonts.gstatic.com/s/notosanssc/v41/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf";
const NOTO_LICENSE = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt";

async function write(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value) + "\n");
  if (!(await readFile(file).catch(() => Buffer.alloc(0))).equals(bytes))
    await writeFile(file, bytes);
}

// Read Unicode cmap mappings, rather than assuming that a Japanese font covers Chinese.
function glyphChecker(buffer) {
  let cmap;
  for (let n = 0; n < buffer.readUInt16BE(4); n++) {
    const at = 12 + n * 16;
    if (buffer.toString("ascii", at, at + 4) === "cmap") cmap = buffer.readUInt32BE(at + 8);
  }
  if (cmap === undefined) return () => false;
  const checks = [];
  for (let n = 0; n < buffer.readUInt16BE(cmap + 2); n++) {
    const at = cmap + 4 + n * 8;
    const platform = buffer.readUInt16BE(at),
      encoding = buffer.readUInt16BE(at + 2);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    const base = cmap + buffer.readUInt32BE(at + 4),
      format = buffer.readUInt16BE(base);
    if (format === 12) {
      const groups = [];
      for (let n = 0; n < buffer.readUInt32BE(base + 12); n++) {
        const at = base + 16 + n * 12;
        groups.push([
          buffer.readUInt32BE(at),
          buffer.readUInt32BE(at + 4),
          buffer.readUInt32BE(at + 8),
        ]);
      }
      checks.push((cp) =>
        groups.some(
          ([first, last, glyph]) => cp >= first && cp <= last && glyph + cp - first !== 0,
        ),
      );
    } else if (format === 4) {
      const segments = buffer.readUInt16BE(base + 6) / 2;
      checks.push((cp) => {
        for (let n = 0; n < segments; n++) {
          if (cp > buffer.readUInt16BE(base + 14 + n * 2)) continue;
          const start = buffer.readUInt16BE(base + 16 + segments * 2 + n * 2);
          if (cp < start) return false;
          const delta = buffer.readInt16BE(base + 16 + segments * 4 + n * 2);
          const at = base + 16 + segments * 6 + n * 2,
            offset = buffer.readUInt16BE(at);
          if (!offset) return ((cp + delta) & 65535) !== 0;
          const glyph = buffer.readUInt16BE(at + offset + (cp - start) * 2);
          return glyph !== 0 && ((glyph + delta) & 65535) !== 0;
        }
        return false;
      });
    }
  }
  return (cp) => checks.some((check) => check(cp));
}

function coverage(bytes, characters) {
  const contains = glyphChecker(bytes);
  const missing = characters.filter((character) => !contains(character.codePointAt(0)));
  return {
    requiredHan: characters.length,
    coveredHan: characters.length - missing.length,
    missing,
  };
}

async function download(out, url, magic = null) {
  const cache = path.join(out, ".cache/presentation", hash(url));
  let bytes = await readFile(cache).catch(() => null);
  if (bytes && magic && bytes.toString("ascii", 0, magic.length) !== magic) bytes = null;
  if (!bytes) {
    const response = await fetch(url);
    if (!response.ok) throw Error(`Presentation font download ${response.status}: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (magic && bytes.toString("ascii", 0, magic.length) !== magic)
      throw Error(`Unexpected font format: ${url}`);
    await write(cache, bytes);
  }
  return bytes;
}

function layoutFrom(bundle, names, primary, media, warnings) {
  const objects = new Map(bundle.objects.map((object) => [key(object.source), object]));
  const transformFor = new Map();
  const components = new Map();
  function target(owner, ref) {
    if (!ref?.m_PathID || ref.m_PathID === "0") return null;
    let file = owner.source.serializedFile;
    if (ref.m_FileID) {
      const external = bundle.externalFiles[file]?.find((entry) => entry.fileId === ref.m_FileID);
      if (!external) return null;
      file = path.posix.basename(external.path);
    }
    return `${file}::${ref.m_PathID}`;
  }
  for (const object of bundle.objects) {
    const gameObject = target(object, object.data.m_GameObject);
    if (!gameObject) continue;
    if (object.type === "RectTransform") transformFor.set(gameObject, object);
    else if (object.type === "MonoBehaviour") {
      if (!components.has(gameObject)) components.set(gameObject, []);
      components.get(gameObject).push(object);
    }
  }
  const geometries = new Map(),
    paths = new Map();
  function geometry(transform, seen = new Set()) {
    const id = key(transform.source);
    if (geometries.has(id)) return geometries.get(id);
    if (seen.has(id)) return null;
    seen.add(id);
    const data = transform.data;
    const parent = objects.get(target(transform, data.m_Father));
    const parentRect =
      parent?.type === "RectTransform"
        ? geometry(parent, seen)
        : { rect: [0, 0, 1920, 1080], scale: [1, 1] };
    if (!parentRect) return null;
    const [px, py, pw, ph] = parentRect.rect,
      [sx, sy] = parentRect.scale;
    const lo = vector(data.m_AnchorMin),
      hi = vector(data.m_AnchorMax),
      pivot = vector(data.m_Pivot, 0.5);
    const position = vector(data.m_AnchoredPosition),
      size = vector(data.m_SizeDelta),
      scale = vector(data.m_LocalScale, 1);
    const width = pw * (hi[0] - lo[0]) + size[0] * sx;
    const height = ph * (hi[1] - lo[1]) + size[1] * sy;
    const anchorX = px + pw * (lo[0] + (hi[0] - lo[0]) * pivot[0]) + position[0] * sx;
    const anchorY = py + ph * (1 - lo[1] - (hi[1] - lo[1]) * pivot[1]) - position[1] * sy;
    const value = {
      rect: [
        anchorX - width * scale[0] * pivot[0],
        anchorY - height * scale[1] * (1 - pivot[1]),
        width * scale[0],
        height * scale[1],
      ],
      scale: [sx * scale[0], sy * scale[1]],
    };
    geometries.set(id, value);
    return value;
  }
  function objectName(transform) {
    return objects.get(target(transform, transform.data.m_GameObject))?.name || transform.name;
  }
  function objectPath(transform, seen = new Set()) {
    const id = key(transform.source);
    if (paths.has(id)) return paths.get(id);
    if (seen.has(id)) return objectName(transform);
    seen.add(id);
    const parent = objects.get(target(transform, transform.data.m_Father));
    const result =
      (parent?.type === "RectTransform" ? objectPath(parent, seen) + "/" : "") +
      objectName(transform);
    paths.set(id, result);
    return result;
  }
  const transforms = bundle.objects.filter((object) => object.type === "RectTransform");
  const roots = transforms.filter((object) => object.data.m_Father?.m_PathID === "0");
  const chosen = roots.filter((root) => names.includes(objectName(root)));
  const wanted = new Set();
  function include(transform) {
    const id = key(transform.source);
    if (wanted.has(id)) return;
    wanted.add(id);
    for (const ref of transform.data.m_Children || []) {
      const child = objects.get(target(transform, ref));
      if (child?.type === "RectTransform") include(child);
    }
  }
  chosen.forEach(include);
  const rects = [];
  for (const transform of transforms.filter((object) => wanted.has(key(object.source)))) {
    const data = transform.data;
    const gameObjectId = target(transform, data.m_GameObject),
      gameObject = objects.get(gameObjectId);
    const list = components.get(gameObjectId) || [];
    const text = list.find((object) => object.class === "Text");
    const image = list.find((object) => object.class === "Image");
    const layout = list.find((object) => /LayoutGroup$/.test(object.class));
    const row = {
      name: objectName(transform),
      path: objectPath(transform),
      anchors: [...vector(data.m_AnchorMin), ...vector(data.m_AnchorMax)],
      pivot: vector(data.m_Pivot),
      position: vector(data.m_AnchoredPosition),
      size: vector(data.m_SizeDelta),
      scale: vector(data.m_LocalScale, 1),
      active: gameObject?.data.m_IsActive !== false,
      rect: geometry(transform)?.rect.map((number) => Math.round(number * 1000) / 1000),
    };
    if (text)
      row.text = {
        value: text.data.m_Text,
        size: text.data.m_FontData?.m_FontSize,
        alignment: text.data.m_FontData?.m_Alignment,
        lineSpacing: text.data.m_FontData?.m_LineSpacing,
        color: text.data.m_Color,
        font: objects.get(target(text, text.data.m_FontData?.m_Font))?.name,
      };
    if (image) {
      const sprite = media.get(target(image, image.data.m_Sprite));
      row.image = {
        sprite: sprite?.name,
        url: sprite?.url ? webURL(sprite.url) : undefined,
        color: image.data.m_Color,
        type: image.data.m_Type,
        preserveAspect: Boolean(image.data.m_PreserveAspect),
      };
    }
    if (layout)
      row.layoutGroup = {
        type: layout.class,
        padding: layout.data.m_Padding,
        spacing: layout.data.m_Spacing,
        cellSize: layout.data.m_CellSize,
        alignment: layout.data.m_ChildAlignment,
      };
    rects.push(row);
  }
  const candidate = rects.find((row) => row.name === primary);
  const bounds = candidate?.rect;
  const valid =
    bounds?.every(Number.isFinite) &&
    bounds[0] >= 0 &&
    bounds[1] >= 0 &&
    bounds[2] > 0 &&
    bounds[3] > 0 &&
    bounds[0] + bounds[2] <= 1920.001 &&
    bounds[1] + bounds[3] <= 1080.001;
  if (!valid)
    warnings.push(
      `${primary}: authored prefab placement is incomplete or outside the reference canvas; no screen bounds exported.`,
    );
  return {
    prefab: primary,
    ...(valid ? { bounds } : {}),
    rects,
    templates: roots.map((root) => ({
      name: objectName(root),
      size: vector(root.data.m_SizeDelta),
      anchors: [...vector(root.data.m_AnchorMin), ...vector(root.data.m_AnchorMax)],
      pivot: vector(root.data.m_Pivot),
      position: vector(root.data.m_AnchoredPosition),
    })),
  };
}

export async function compilePresentation(out, { game = null } = {}) {
  out = path.resolve(out);
  const started = Date.now(),
    warnings = [];
  const [media, tables, messages, extraction] = await Promise.all(
    ["raw/media.json", "raw/tables.json", "raw/messages.json", ".cache/unity-export.json"].map(
      (file) => read(path.join(out, file)),
    ),
  );
  game ||= extraction.game;
  const objectDirectory = path.join(out, "raw/objects"),
    objectFiles = await readdir(objectDirectory);
  const bundles = new Map();
  async function bundle(prefix) {
    if (!bundles.has(prefix)) {
      const file = objectFiles.find((file) => file.startsWith(`${prefix}_`));
      if (!file) throw Error(`Missing PR UI metadata ${prefix}`);
      bundles.set(prefix, await read(path.join(objectDirectory, file)));
    }
    return bundles.get(prefix);
  }
  const common = media.sprites.filter((sprite) =>
    sprite.source.file.includes("/common_assets_all_"),
  );
  function sprite(row) {
    if (!row?.url) throw Error("Required PR UI sprite is missing");
    return {
      name: row.name,
      url: webURL(row.url),
      width: row.width,
      height: row.height,
      pivot: row.pivot,
    };
  }
  const choose = (name) => common.find((row) => row.name === name);
  const bindings = {
    window: "UI_Common_WindowFrame01",
    windowBackground: "UI_Common_WindowFrame02",
    windowFlat: "UI_Common_WindowFrame04",
    windowSmall: "UI_Common_WindowFrame05",
    cursor: "UI_Common_Cursor01",
    cursorSmall: "UI_Common_Cursor02",
    atb: "UI_Common_ATBgauge01",
    atbFill: "UI_Common_ATBgauge02",
    gauge: "UI_Common_gauge01",
    scrollArrow: "UI_Common_ScrollArrow01",
    publisherLogo: "UI_Common_TitleLogoImage01",
  };
  const sprites = Object.fromEntries(
    Object.entries(bindings).map(([name, value]) => [name, sprite(choose(value))]),
  );
  const titleLogo = media.sprites.find(
    (row) =>
      row.name === "TitleLogoImage_ZH-CH" && row.source.file.includes("/common_title_assets_all_"),
  );
  sprites.titleLogo = sprite(titleLogo);
  const requests = Object.entries(bindings).map(([name, value]) => ({
    key: name,
    ...choose(value).source,
  }));
  requests.push({ key: "titleLogo", ...titleLogo.source });
  const python = process.env.PYTHON || path.join(project, ".venv/bin/python");
  const borderResult = spawnSync(
    python,
    [path.join(import.meta.dirname, "ui_sprite_metadata.py"), "--game", game],
    { input: JSON.stringify(requests), encoding: "utf8" },
  );
  if (borderResult.status !== 0)
    throw Error(`PR UI sprite border extraction failed: ${borderResult.stderr}`);
  const borders = JSON.parse(borderResult.stdout);
  for (const name of Object.keys(sprites)) {
    if (!borders[name]) throw Error(`PR Sprite border is missing: ${name}`);
    sprites[name].border = borders[name];
  }
  const icons = Object.fromEntries(
    media.sprites
      .filter((row) => row.source.file.includes("/ui_icons_"))
      .map((row) => [row.name, sprite(row)]),
  );
  const portraits = {};
  for (const row of media.sprites) {
    const face = row.source.assetPath?.match(/\/(FA_FF6_P\d+)\//i)?.[1].toLowerCase();
    if (face && row.name === "Default_00") portraits[face] = sprite(row);
  }
  const assets = new Map((tables["character_asset.csv"] || []).map((row) => [row.id.trim(), row]));
  const faces = [...assets.values()].filter(
    (row) => portraits[row.asset_name?.trim().toLowerCase()],
  );
  const characterFaces = {};
  for (const row of tables["character_status.csv"] || []) {
    const body = assets.get(row.character_asset_id?.trim());
    const face = faces.find(
      (face) => face.field_character_asset_id?.trim() === body?.field_character_asset_id?.trim(),
    );
    if (face) characterFaces[row.id.trim()] = face.asset_name.trim().toLowerCase();
  }
  const iconTags = {};
  for (const row of tables["icon.csv"] || []) {
    const name = `UI_Common_Icon${String(Number(row.id)).padStart(2, "0")}`;
    if (icons[name]) iconTags[row.tag_name.trim()] = name;
  }
  const localizedNames = Object.assign(
    {},
    ...Object.entries(messages)
      .filter(([name]) => name.endsWith("_zhc"))
      .map(([, table]) => table.values || {}),
  );
  const contentIcons = {};
  for (const row of tables["content.csv"] || []) {
    // This PR build has icon_id=0 throughout content.csv. Item/equipment names
    // carry the authoritative <IC_...> tags instead.
    const tag = localizedNames[row.mes_id_name.trim()]?.match(/<IC_[A-Z0-9_]+>/)?.[0];
    const name =
      Number(row.icon_id) > 0
        ? `UI_Common_Icon${String(Number(row.icon_id)).padStart(2, "0")}`
        : iconTags[tag];
    if (icons[name]) contentIcons[row.id.trim()] = name;
  }
  const areas = new Map((tables["area.csv"] || []).map((row) => [row.id.trim(), row]));
  const mapNames = {};
  for (const row of tables["map.csv"] || []) {
    const area = areas.get(row.area_id.trim());
    const name = [row.map_title, area?.area_name]
      .map((id) => localizedNames[id?.trim()]?.trim())
      .find((name) => name && name !== "None");
    if (name) mapNames[row.id.trim()] = name;
  }
  const localized = Object.entries(messages)
    .filter(([name]) => name.endsWith("_zhc"))
    .flatMap(([, table]) => Object.values(table.values || {}));
  const characters = [...new Set(localized.join(""))].filter((character) =>
    /\p{Script=Han}/u.test(character),
  );
  const [noto, notoTTF, license] = await Promise.all([
    download(out, NOTO_WOFF2, "wOF2"),
    download(out, NOTO_TTF),
    download(out, NOTO_LICENSE),
  ]);
  const notoCoverage = coverage(notoTTF, characters);
  if (notoCoverage.missing.length)
    throw Error(`Noto Sans SC lacks ${notoCoverage.missing.length} PR Chinese characters`);
  const licenseFile = `fonts/${hash(license)}.txt`;
  await write(path.join(out, licenseFile), license);
  const notoFile = `fonts/${hash(noto)}.woff2`;
  await write(path.join(out, notoFile), noto);
  const fonts = [
    {
      family: "Noto Sans SC",
      originalName: "Noto Sans SC Regular",
      url: webURL(notoFile),
      format: "woff2",
      weight: 400,
      primary: true,
      bytes: noto.length,
      coverage: notoCoverage,
      license: "SIL Open Font License 1.1",
      licenseFile: webURL(licenseFile),
      licenseSource: NOTO_LICENSE,
      sourceURL: NOTO_WOFF2,
      coverageSourceURL: NOTO_TTF,
    },
  ];
  const originals = new Map();
  for (const prefix of ["key_menu", "key_battle", "touch_field_ui"])
    for (const object of (await bundle(prefix)).objects)
      if (object.type === "Font" && object.data.m_FontData?.length && !originals.has(object.name))
        originals.set(object.name, object);
  for (const [name, object] of originals) {
    const bytes = Buffer.from(object.data.m_FontData),
      format = bytes.toString("ascii", 0, 4) === "OTTO" ? "otf" : "ttf";
    const file = `fonts/${hash(bytes)}.${format}`;
    await write(path.join(out, file), bytes);
    fonts.push({
      family: name,
      originalName: name,
      familyNames: object.data.m_FontNames,
      url: webURL(file),
      format: format === "otf" ? "opentype" : "truetype",
      bytes: bytes.length,
      primary: false,
      coverage: coverage(bytes, characters),
    });
  }
  warnings.push(
    "PR serialized Japanese/Latin fonts lack Simplified Chinese glyphs; the full Noto Sans SC Regular font is a logged visual substitute, not the original localized PR typeface.",
  );
  warnings.push(
    "RectTransform bounds are authored prefab positions on the PR 1920x1080 reference canvas; runtime anchoring, animation, ContentSizeFitter and LayoutGroup reflow are not interpreted.",
  );
  warnings.push(
    "PR rename uses custom ChangeName controllers; exported metadata has no rename character limit. Scene InputField characterLimit=0 is unrelated to rename. Any six-character UI limit remains an explicit approximation.",
  );
  const mediaById = new Map(media.sprites.map((row) => [key(row.source), row]));
  const definitions = {
    message: [
      "key_common",
      ["message_window", "message_system_window", "message_choices_window"],
      "message_window",
    ],
    battle: [
      "key_battle",
      [
        "battle_info_window",
        "player_info_window",
        "target_select_info_window",
        "command_message_window",
        "enemy_info_window",
      ],
      "battle_info_window",
    ],
    menu: ["key_menu", ["menu_base"], "menu_base"],
    shop: ["key_shop", ["shop_base"], "shop_base"],
    title: ["key_title", ["title"], "title"],
    save: ["touch_savewindow_ui", ["save_window"], "save_list_window"],
    name: ["touch_change_name", ["change_name_base"], "change_name_base"],
  };
  const layouts = {};
  for (const [name, [prefix, roots, primary]] of Object.entries(definitions))
    layouts[name] = layoutFrom(await bundle(prefix), roots, primary, mediaById, warnings);
  const scene = await bundle("scene_maingame");
  const scaler = scene.objects.find(
    (object) => object.class === "CanvasScaler" && object.data.m_ReferenceResolution?.x === 1920,
  );
  if (!scaler || scaler.data.m_ReferenceResolution.y !== 1080)
    throw Error("PR UI reference resolution changed");
  const presentation = {
    reference: { width: 1920, height: 1080 },
    sprites,
    icons,
    iconTags,
    contentIcons,
    mapNames,
    portraits,
    characterFaces,
    fonts,
    layouts,
    naming: { characterLimit: null },
    warnings,
  };
  const urls = new Set();
  function references(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        ["url", "licenseFile"].includes(key) &&
        typeof child === "string" &&
        child.startsWith("/web-data/")
      )
        urls.add(child);
      else if (child && typeof child === "object") references(child);
    }
  }
  references(presentation);
  for (const url of urls) await access(path.join(out, url.replace(/^\/web-data\//, "")));
  await write(path.join(out, "presentation.json"), presentation);
  for (const warning of warnings) console.warn(`[presentation] ${warning}`);
  const summary = {
    sprites: Object.keys(sprites).length,
    icons: Object.keys(icons).length,
    portraits: Object.keys(portraits).length,
    characterFaces: Object.keys(characterFaces).length,
    mapNames: Object.keys(mapNames).length,
    fonts: fonts.map(({ family, bytes, coverage, primary }) => ({
      family,
      bytes,
      coveredHan: coverage.coveredHan,
      requiredHan: coverage.requiredHan,
      primary,
    })),
    layouts: Object.fromEntries(
      Object.entries(layouts).map(([name, value]) => [
        name,
        { bounds: value.bounds || null, rects: value.rects.length },
      ]),
    ),
    bytes: Buffer.byteLength(JSON.stringify(presentation)),
    elapsedSeconds: (Date.now() - started) / 1000,
  };
  console.log(JSON.stringify(summary));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    at = args.indexOf("--data");
  await compilePresentation(at >= 0 ? args[at + 1] : path.join(project, "build/web-data"));
}
