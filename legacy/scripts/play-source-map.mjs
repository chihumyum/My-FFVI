import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const json = async file => JSON.parse(await readFile(resolve(root, file), 'utf8'));
const bundleCache = new Map();
let commonPromise, filesPromise;
const common = () => commonPromise ??= Promise.all([
  json('build/corpus/tables.json'), json('build/world-media/media.json'),
]).then(([tables, media]) => ({ tables, media }));
const sources = source => ({ file: source.file, assetPath: source.assetPath });
const properties = object => Object.fromEntries((object.properties || []).map(row => [row.name, row.value]));
const objectLayers = { BottomObject: 0, GroundObject: 1, UpperObject: 2, CeilObject: 3, MinimapObject: 4 };
const collisionLayers = { BottomCollision: 0, GroundCollision: 1, UpperCollision: 2, CeilCollision: 3 };
const directions = { 0: 'down', 1: 'up', 2: 'right', 4: 'down', 8: 'left' };

async function readBundle(file) {
  const name = basename(file).replace(/\.bundle$/, '.json');
  if (!bundleCache.has(name)) bundleCache.set(name, json(`build/corpus/bundles/${name}`).catch(() => null));
  return bundleCache.get(name);
}

function walkLayers(data, visit, path = '', inherited = {}) {
  for (const [index, layer] of (data.layers || []).entries()) {
    const pointer = `${path}/layers/${index}`;
    const context = { x: (inherited.x || 0) + Number(layer.x || 0),
      y: (inherited.y || 0) + Number(layer.y || 0),
      offsetx: (inherited.offsetx || 0) + Number(layer.offsetx || 0),
      offsety: (inherited.offsety || 0) + Number(layer.offsety || 0),
      opacity: (inherited.opacity ?? 1) * Number(layer.opacity ?? 1),
      visible: inherited.visible !== false && layer.visible !== false,
      group: layer.type === 'group' ? layer.name : inherited.group };
    if (layer.layers) walkLayers(layer, visit, pointer, context);
    else visit(layer, pointer, context);
  }
}

// Recover only the extracted PR package's grid and entities. This intentionally
// does not run the legacy compiler or use its MapRange clipping/asset gates.
// Nothing is written: callers decide which one recovered map to cache/export.
export async function recoverSourceMap(src) {
  if (src.map) return src.map;
  const { tables, media } = await common();
  const row = (tables['map.csv'] || []).find(row => Number(row.id) === Number(src.mapId));
  if (!row?.asset_name) return null;
  const mapName = row.map_name || src.name;
  const preferred = (src.blockers || []).map(blocker => blocker.source?.file)
    .filter(file => basename(file || '').toLowerCase().startsWith(`${row.asset_name.toLowerCase()}_assets_all_`));
  const files = await (filesPromise ??= readdir(resolve(root, 'build/corpus/bundles')));
  const candidates = [...new Set([...preferred, ...files.filter(file =>
    file.toLowerCase().startsWith(`${row.asset_name.toLowerCase()}_assets_all_`) && file.endsWith('.json'))])];
  for (const file of candidates) {
    const bundle = await readBundle(file);
    if (!bundle) continue;
    for (const pack of bundle.filter(asset => asset.source.assetPath.endsWith('/package.json'))) {
      const declaration = (pack.data.map || []).find(map => map.name === mapName);
      if (!declaration) continue;
      const prefix = pack.source.assetPath.slice(0, -'package.json'.length);
      const assetAt = path => {
        if (!path) return null;
        const assetPath = (path.startsWith('Assets/') ? path : prefix + path).replace(/(?:\.json)?$/, '.json');
        return bundle.find(asset => asset.source.assetPath === assetPath);
      };
      const tilemap = assetAt(declaration.tilemap), collision = assetAt(declaration.collision),
        defaults = assetAt(declaration.entity_default);
      if (!tilemap || !collision || !defaults) continue;
      const tileSize = Number(tilemap.data.tilewidth || tilemap.data.tileheight || 16),
        width = Number(tilemap.data.width), height = Number(tilemap.data.height);
      if (!(width > 0 && height > 0 && tileSize > 0)) continue;
      const guesses = [];
      const warn = message => { if (!guesses.includes(message)) guesses.push(message); };
      const layers = [], collisions = {}, entities = [], groups = {};
      walkLayers(tilemap.data, (layer, pointer, context) => {
        if (layer.type !== 'tilelayer') return;
        if (!Array.isArray(layer.data)) {
          warn(`Tile layer ${layer.name} has no ordinary data array; its visual was omitted.`);
          return;
        }
        if (context.x || context.y || context.offsetx || context.offsety)
          warn('Recovered visual layers retain their full grids; tile-layer offsets are not rendered.');
        // Keep PR tile IDs, including flip bits and animation tilesets.
        layers.push({ name: layer.name, width: layer.width || width, height: layer.height || height,
          data: layer.data, opacity: context.visible ? context.opacity : 0, sourceGroup: context.group || '' });
      });
      walkLayers(collision.data, layer => {
        if (!Array.isArray(layer.data)) return;
        const index = collisionLayers[layer.name];
        if (index === undefined) {
          warn(`Collision layer ${layer.name} has no known walking-layer name; it was omitted.`);
          return;
        }
        collisions[index] = layer.data;
        if (Number(layer.width) !== width || Number(layer.height) !== height)
          warn(`Collision layer ${layer.name} retains its source grid ${layer.width}×${layer.height}; tilemap is ${width}×${height}.`);
      });
      const scriptRows = new Map((tables['script.csv'] || []).map(row => [Number(row.id), row.script_name]));
      const assets = new Map((tables['mapobject.csv'] || []).map(row => [Number(row.id), row.asset_name]));
      const interaction = (p, script) => ({ acceptDirection: Number(p.accept_action_direction ?? 15),
        collision: p.collision !== false, soundId: Number(p.se_id || 0), talkMounts: [],
        interaction: script ? { kind: 'script', script } : p.message_key ? { kind: 'talk', key: p.message_key } : { kind: 'none' } });
      const addGroup = (name, asset) => {
        const output = [];
        walkLayers(asset.data, (layer, pointer, context) => {
          if (!layer.objects) return;
          let layerId = objectLayers[layer.name];
          if (layerId === undefined) {
            const match = layer.name?.match(/^(Bottom|Ground|Upper|Ceil)/);
            layerId = match ? { Bottom: 0, Ground: 1, Upper: 2, Ceil: 3 }[match[1]] : 1;
            warn(`Entity layer ${layer.name} uses walking layer ${layerId}; the unknown suffix is ignored.`);
          }
          for (const [index, object] of layer.objects.entries()) {
            const p = properties(object), kind = Number(p.object_type ?? -1);
            if (kind < 0) continue;
            if (kind === 27) warn(`MapRange (${object.x},${object.y},${object.width},${object.height}) is editor metadata; recovery uses the actual ${width}×${height} grid.`);
            const script = scriptRows.get(Number(p.script_id)) || null;
            if (Number(p.script_id) && !script) warn(`Entity ${p.entity_id || object.id} refers to missing script ${p.script_id}; its source selector is retained.`);
            const layerPath = pointer.split('/').filter(part => /^\d+$/.test(part)).join(':');
            const entity = { id: String(p.entity_id || `${name}:${layerPath}:${index}`), kind,
              objectId: Number(p.object_id || 0), layer: layerId,
              x: (Number(object.x || 0) + context.offsetx + context.x) / tileSize,
              y: (Number(object.y || 0) + context.offsety + context.y) / tileSize -
                (object.gid && kind !== 1 ? Number(object.height || tileSize) / tileSize : 0),
              width: Number(object.width || tileSize) / tileSize,
              height: Number(object.height || tileSize) / tileSize,
              direction: directions[Number(p.direction || 0)] || 'down',
              visible: context.visible && object.visible !== false,
              asset: assets.get(Number(p.asset_id)) || null, script,
              collision: null, destinationLayer: kind === 4 ? Number(p.layer) : null,
              source: { ...sources(asset.source), pointer: `${pointer}/objects/${index}` } };
            if (kind === 3) entity.destination = { mapId: Number(p.map_id), entrance: Number(p.point_id || 1) };
            if (kind === 30) Object.assign(entity, { leaveScriptId: Number(p.leave_script_id || 0), actionId: Number(p.action_id || 0) });
            if ([6, 17].includes(kind)) entity.npc = { ...interaction(p, script),
              moveType: Number(p.move_type || 0), pushed: Boolean(p.pushed), eyeContact: Boolean(p.eye_contact),
              turnAround: Boolean(p.turn_around), allLayers: Boolean(p.all_layers), birdview: Boolean(p.birdview_puppet) };
            if ([5, 10].includes(kind)) entity.mapObject = interaction(p, script);
            if (kind === 7) entity.treasure = { contentId: Number(p.content_id || 0), count: Number(p.content_num || 1), flagId: Number(p.flag_id || 0) };
            output.push(entity);
          }
        });
        groups[name] = { name, entities: output, source: sources(asset.source) };
        if (name === 'entity_default') entities.push(...output);
      };
      addGroup('entity_default', defaults);
      for (const declarationGroup of declaration.entity || []) {
        const name = typeof declarationGroup === 'string' ? basename(declarationGroup) : declarationGroup.name;
        const asset = assetAt(typeof declarationGroup === 'string' ? declarationGroup : declarationGroup.asset);
        if (asset) addGroup(name, asset);
        else warn(`Source entity group ${name} is missing from the extracted package.`);
      }
      const packageKey = `${basename(pack.source.file)}::${pack.source.assetPath}`;
      const packageMedia = media.packages?.[packageKey] || Object.values(media.packages || {})
        .find(item => item.source?.assetPath === pack.source.assetPath);
      const textures = Object.fromEntries(Object.entries(packageMedia?.textures || {}).filter(([, value]) => value.file)
        .map(([key, value]) => [key, value.file.startsWith('/') ? value.file : `/world-media/${value.file}`]));
      for (const tileset of tilemap.data.tilesets || []) if (tileset.image && !textures[tileset.image])
        warn(`PR tileset texture ${tileset.image} has no existing world-media file; its cells remain visually empty.`);
      if (!Object.keys(collisions).length) warn('No ordinary source collision layer was found; walking uses the field fallback.');
      return { width, height, tileSize, layers, tilesets: tilemap.data.tilesets || [], textures,
        collisions, entities, groups, source: sources(tilemap.source), guesses };
    }
  }
  return null;
}
