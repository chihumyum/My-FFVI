import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const numeric = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]),
  );
const sprite = (s) => ({
  url: "/web-data/" + s.url,
  width: s.width,
  height: s.height,
  pivot: s.pivot,
});

export async function compileBattlePresentation(out) {
  const [media, tables, index] = await Promise.all(
    ["raw/media.json", "raw/tables.json", "raw/index.json"].map((p) => read(path.join(out, p))),
  );
  const groups = {};
  for (const s of media.sprites) {
    const match = s.source.assetPath?.match(/\/(BC_FF6_[^/]+|WP_FF6_[^/]+)\/[^/]+\.png$/i);
    if (match) (groups[match[1].toLowerCase()] ||= {})[s.name] = sprite(s);
  }
  const equipment = Object.fromEntries(
    tables["battle_equipment_asset.csv"].map(numeric).map((r) => [
      r.id,
      {
        asset: r.asset_name.toLowerCase(),
        type: r.type_id,
        motion: r.motion_type,
      },
    ]),
  );
  const miscBundle = index.files.find(
    (file) => file.file.includes("/misc_assets_all_") && file.bundleOutput,
  );
  const misc = (await read(path.join(out, miscBundle.bundleOutput))).find((asset) =>
    Array.isArray(asset.data.battle_anim_alias_table),
  );
  const animationAliases = Object.fromEntries(
    misc.data.battle_anim_alias_table.map((row) => [row.key, row]),
  );
  const scene = index.files.find((f) => f.file.includes("scene_maingame_") && f.objectsOutput);
  const objects = (await read(path.join(out, scene.objectsOutput))).objects;
  const controller = objects.find((o) => o.class === "BattleController");
  const ids = new Map(
    objects
      .filter((o) => o.source.serializedFile === controller.source.serializedFile)
      .map((o) => [o.source.pathId, o]),
  );
  const enemy = ids.get(controller.data.enemyPartyTransform.m_PathID)?.data.m_LocalPosition;
  if (!enemy) throw Error("Missing PR BattleController enemy party origin");
  const title = index.files.find((f) => f.file.includes("scene_title_") && f.objectsOutput);
  const cameras = (await read(path.join(out, title.objectsOutput))).objects;
  const camera = cameras.find(
    (o) =>
      o.type === "Camera" &&
      cameras.some(
        (g) =>
          g.type === "GameObject" &&
          g.name === "CameraBattle" &&
          g.source.serializedFile === o.source.serializedFile &&
          g.source.pathId === o.data.m_GameObject.m_PathID,
      ),
  );
  if (!camera) throw Error("Missing PR CameraBattle");
  const digits = Object.fromEntries(
    media.sprites
      .filter((s) => s.source.file.includes("view_damage_") && /DamageNumber_\d$/.test(s.name))
      .map((s) => [s.name.match(/(\d)$/)[1], sprite(s)]),
  );
  const miss = media.sprites.find(
    (s) => s.source.file.includes("miss_sprite_") && s.name.endsWith("_Miss_9"),
  );
  const data = {
    camera: { orthographicSize: camera.data["orthographic size"], width: 384, height: 216 },
    enemyOrigin: { x: enemy.x, y: enemy.y },
    // PR BattleEnemyInstanceData uses a 35-unit unique-slot lattice (ctor
    // 1584f6d; GetPosUniqueAdjust 1584c90), in addition to the CSV offsets.
    enemySlots: [
      { x: 43, y: 35 },
      { x: 35, y: 0 },
      { x: 27, y: -35 },
      { x: 8, y: 35 },
      { x: 0, y: 0 },
      { x: -8, y: -35 },
      { x: -27, y: 35 },
      { x: -35, y: 0 },
      { x: -43, y: -35 },
    ],
    groups,
    animationAliases,
    magitek: { asset: "bc_ff6_p022" },
    equipment,
    digits,
    miss: sprite(miss),
    warnings: [
      "Enemy draw priority uses inverse PR formation slot to retain multipart bosses; native runtime depth updates are not exported.",
      "Player positions use PR game constants; Magitek vertical spacing expands for the full rider/armor extent. Six-frame-per-second pose timing remains approximate.",
      "Weapon motion_type is retained; web swing angles and hand attachment timing are approximated without altering battle resolution.",
      "Magitek uses PR rider/armor frames, native texture offsets and mesh positions. Web draws the clipped rider above the armor rather than reproducing native mesh depth.",
      "Simplified Chinese MISS uses PR Miss_9 (visually identified as 失手); digit bounce timing is approximated.",
    ],
  };
  await writeFile(path.join(out, "battle-presentation.json"), JSON.stringify(data) + "\n");
  return {
    groups: Object.keys(groups).length,
    characterGroups: Object.keys(groups).filter((n) => n.startsWith("bc_")).length,
    weaponGroups: Object.keys(groups).filter((n) => n.startsWith("wp_")).length,
    sprites: Object.values(groups).reduce((n, g) => n + Object.keys(g).length, 0),
    digits: Object.keys(digits).length,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(await compileBattlePresentation(path.resolve(process.argv[2] || "build/web-data")));
