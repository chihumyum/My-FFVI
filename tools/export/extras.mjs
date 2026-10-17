import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const project = path.resolve(import.meta.dirname, "../..");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const rows = (table) =>
  Object.values(table || {}).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "string" ? value.trim() : value,
      ]),
    ),
  );
const byId = (table) => Object.fromEntries(rows(table).map((row) => [row.id, row]));
const bundleName = (row) =>
  path
    .basename(row.source?.file || "")
    .split("_assets_all_")[0]
    .toLowerCase();
const url = (file) => (file.startsWith("/web-data/") ? file : `/web-data/${file}`);

export async function compileExtras(out) {
  out = path.resolve(out);
  const [tables, messages, media, audio] = await Promise.all([
    read(path.join(out, "raw/tables.json")),
    read(path.join(out, "raw/messages.json")),
    read(path.join(out, "raw/media.json")),
    read(path.join(out, "audio.json")),
  ]);
  const warnings = [],
    warn = (message) => {
      if (!warnings.includes(message)) warnings.push(message);
    };
  const system = {
      ...messages.system_en?.values,
      ...messages.system_zhc?.values,
    },
    extrasText = {
      ...messages.etc_text_en?.values,
      ...messages.etc_text_zhc?.values,
    };
  const text = (catalog, key) => {
    const value = catalog[key];
    if (value === undefined) warn(`PR message ${key} is absent; keep its source key as the label.`);
    return value ?? key;
  };
  const sprites = new Map(),
    textures = new Map();
  for (const row of media.sprites || [])
    if (row.url) sprites.set(`${bundleName(row)}/${row.name.toLowerCase()}`, row);
  for (const row of media.textures || [])
    if (row.url) textures.set(`${bundleName(row)}/${row.name.toLowerCase()}`, row);
  const image = (bundle, name) => {
    const key = `${bundle}/${name}`.toLowerCase(),
      sprite = sprites.get(key);
    if (sprite) return { url: url(sprite.url), width: sprite.width, height: sprite.height };
    const texture = textures.get(key);
    if (!texture) return null;
    warn(`No Sprite for ${key}; use its exported top-left Texture2D image.`);
    return {
      url: url(texture.displayUrl || texture.url),
      width: texture.width,
      height: texture.height,
    };
  };
  const gallery = rows(tables["gallery_list.csv"]).map((row) => {
    const artwork = image(row.asset_group_name, row.asset_name);
    if (!artwork)
      throw Error(`Gallery source image is missing: ${row.asset_group_name}/${row.asset_name}`);
    return {
      id: Number(row.id),
      name: text(extrasText, row.message_id),
      image: artwork,
    };
  });
  const monsters = byId(tables["monster.csv"]),
    monsterAssets = byId(tables["monster_asset.csv"]),
    areas = byId(tables["area.csv"]),
    points = byId(tables["habitat_point.csv"]),
    habitatGroups = rows(tables["habitat_point_group.csv"]),
    habitatAssets = rows(tables["habitat_asset.csv"]);
  const thumbnailRows = (media.sprites || []).filter((row) => /^mt_ff6_/i.test(bundleName(row)));
  const thumbnailNames = new Map();
  for (const book of rows(tables["picture_book.csv"])) {
    const monster = monsters[book.monster_id];
    const asset = monsterAssets[Number(book.overwrite_asset_id) || monster?.monster_asset_id];
    if (!asset) continue;
    const key = `${asset.group_name.replace(/^mn_/i, "mt_")}_${asset.asset_name}`.toLowerCase();
    if (!thumbnailNames.has(key)) thumbnailNames.set(key, []);
    if (!thumbnailNames.get(key).some((entry) => entry.id === Number(monster.id)))
      thumbnailNames
        .get(key)
        .push({ id: Number(monster.id), name: text(system, monster.mes_id_name) });
  }
  warn(
    "Thumbnail association is inferred from matching PR monster_asset mn_ff6_<group>/<variant> to mt_ff6_<group>_<variant>; no explicit thumbnail foreign key is serialized. picture_book.overwrite_asset_id takes precedence for each bestiary entry.",
  );
  const thumbnails = thumbnailRows.map((row) => {
    const id = bundleName(row),
      names = thumbnailNames.get(id) || [],
      ids = names.map((entry) => entry.id);
    return {
      id,
      name: [...new Set(names.map((entry) => entry.name))].join(" / ") || id,
      image: { url: url(row.url), width: row.width, height: row.height },
      ...(ids.length === 1 ? { monsterId: ids[0] } : ids.length ? { monsterIds: ids } : {}),
    };
  });
  const bestiary = rows(tables["picture_book.csv"]).map((row) => {
    const monster = monsters[row.monster_id];
    if (!monster)
      throw Error(`picture_book ${row.id} references missing monster ${row.monster_id}`);
    const assetId = Number(row.overwrite_asset_id) || Number(monster.monster_asset_id),
      asset = monsterAssets[assetId];
    if (!asset) throw Error(`picture_book ${row.id} references missing monster asset ${assetId}`);
    const thumbnailKey =
        `${asset.group_name.replace(/^mn_/i, "mt_")}_${asset.asset_name}`.toLowerCase(),
      thumbnail = image(thumbnailKey, "Thumbnail");
    if (!thumbnail)
      warn(
        `picture_book ${row.id} (monster ${row.monster_id}) has no matching ${thumbnailKey} Sprite; omit its thumbnail, retaining the original monster asset ${assetId}.`,
      );
    const habitats = [];
    for (const group of habitatGroups.filter(
      (group) => group.group_id === row.habitat_point_group_id,
    )) {
      const assets = habitatAssets.filter((asset) => asset.group_id === group.asset_group_id);
      for (let n = 0; n < Number(group.point_max); n++) {
        const point = points[Number(group.base_id) + n];
        if (!point || point.group_id !== group.group_id)
          throw Error(`Invalid PR habitat range ${group.id}: base ${group.base_id}, offset ${n}`);
        const area = areas[point.area_id];
        habitats.push({
          id: Number(point.id),
          areaId: Number(point.area_id),
          name: area?.area_name ? text(system, area.area_name) : "",
          x: Number(point.pos_x),
          y: Number(point.pos_y),
          assetGroupId: Number(group.asset_group_id),
          ...(assets.length ? { world: assets[0].asset_group_name } : {}),
        });
      }
    }
    return {
      id: Number(row.id),
      monsterId: Number(row.monster_id),
      name: text(system, monster.mes_id_name),
      statusDisplay: Number(row.status_display) !== 0,
      monsterAssetId: assetId,
      backgroundId: Number(row.battle_backgroud_id),
      scenarioNumber: Number(row.scenario_number),
      habitatGroupId: Number(row.habitat_point_group_id),
      ...(thumbnail ? { thumbnail, thumbnailKey } : {}),
      habitats,
    };
  });
  const music = rows(tables["sound_player_list.csv"]).map((row) => {
    const bgmId = Number(row.bgm_asset_id),
      track = audio.bgm?.tracks?.[bgmId];
    if (!track) throw Error(`Music player ${row.id} references missing exported BGM ${bgmId}`);
    return {
      id: Number(row.id),
      bgmId,
      name: text(extrasText, row.message_id),
      seconds: Number(row.time),
      fadeout: Number(row.fadeout_flag) !== 0,
    };
  });
  const extras = {
    gallery,
    thumbnails,
    bestiary,
    music,
    audio: { bgm: audio.bgm },
    habitatAssets: habitatAssets.map((row) => ({
      id: Number(row.id),
      groupId: Number(row.group_id),
      scenarioId: Number(row.scenario_id),
      mapId: Number(row.map_id),
      assetGroup: row.asset_group_name,
      assetName: row.asset_name,
    })),
    warnings,
    summary: {
      gallery: gallery.length,
      thumbnails: thumbnails.length,
      bestiary: bestiary.length,
      bestiaryThumbnails: bestiary.filter((entry) => entry.thumbnail).length,
      habitatPoints: bestiary.reduce((sum, entry) => sum + entry.habitats.length, 0),
      music: music.length,
      bgm: Object.keys(audio.bgm.tracks).length,
    },
  };
  const urls = new Set([
    ...gallery.map((entry) => entry.image.url),
    ...thumbnails.map((entry) => entry.image.url),
    ...bestiary.flatMap((entry) => (entry.thumbnail ? [entry.thumbnail.url] : [])),
    ...Object.values(audio.bgm.tracks).map((track) => track.file),
  ]);
  for (const source of urls) {
    if (!source.startsWith("/web-data/")) throw Error(`Unexpected extras source URL ${source}`);
    const file = path.resolve(out, source.slice("/web-data/".length));
    if (!file.startsWith(out + path.sep))
      throw Error(`Extras source leaves output directory ${source}`);
    await stat(file);
  }
  const bytes = Buffer.from(JSON.stringify(extras) + "\n"),
    file = path.join(out, "extras.json");
  if (!(await readFile(file).catch(() => Buffer.alloc(0))).equals(bytes))
    await writeFile(file, bytes);
  console.log(JSON.stringify({ extras: extras.summary, bytes: bytes.length, warnings }));
  return extras;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    at = args.indexOf("--data");
  await compileExtras(at >= 0 ? args[at + 1] : path.join(project, "build/web-data"));
}
