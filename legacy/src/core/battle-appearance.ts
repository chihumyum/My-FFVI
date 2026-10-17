/** Source Magitek presentation state. Animation scheduling belongs to the host;
 * body and armor indices are independent source animation streams. */
export type AppearanceVector = { x: number; y: number };
export type BattleAppearanceGeometry = {
  width: number; height: number; pixelsPerUnit: 1;
  pivot: [0.5, 0]; textureWrap: [1, 1]; filterMode: 0;
};
export type BattleAppearanceAlias = {
  body: string[]; armor: string[];
  textureOffsets: AppearanceVector[]; positions: AppearanceVector[];
};
export type BattleAppearanceCatalog = {
  kind: "source-magitek";
  conditionId: number;
  conditions: { id: number; type: number }[];
  sizeRules: { mog: number; magitekOffset: number; magitekKappa: number };
  aliases: Record<string, BattleAppearanceAlias>;
  armorSprites: Record<string, string>;
  armorGeometry: Record<string, BattleAppearanceGeometry>;
};
export type BattleAppearanceActor = {
  sourceId: number; characterAssetId: number; sizeType: number;
  bodySprites: Record<string, string>;
  bodyGeometry: Record<string, BattleAppearanceGeometry>;
};
export type BattleAppearanceState = {
  currentCharaSize: number; nowCharaSize: number;
  magitek: { conditionId: number; backCharaSize: number } | null;
  textureOffset: AppearanceVector; position: AppearanceVector;
  backAnimKey: string; backSpriteIndex: number;
};
export type BattleAppearanceLayer = {
  sprite: string; width: number; height: number;
  /** Source units are pixels (PPU=1), x right and y up. */
  position: AppearanceVector;
  /** _MainTex offset in UV units. U right, V up; clamp-to-edge, point sampled. */
  textureOffset: AppearanceVector;
};
export type BattleAppearanceProjection = {
  key: string; bodyFrame: number; armorFrame: number;
  charaSize: number;
  /** The alias selects exact source left/right poses; do not mirror by suffix. */
  orientation: "source-alias";
  body: BattleAppearanceLayer; armor: BattleAppearanceLayer | null;
};

const integer = (value: number, min: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < min || value > 0x7fffffff)
    throw new Error("Invalid battle appearance " + label);
};
const vector = (value: AppearanceVector, label: string) => {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y))
    throw new Error("Invalid battle appearance " + label);
};
function actorValid(actor: BattleAppearanceActor) {
  integer(actor.sourceId, 1, "source identity");
  integer(actor.characterAssetId, 1, "asset identity");
  integer(actor.sizeType, 1, "size type");
}
function stateValid(actor: BattleAppearanceActor, state: Readonly<BattleAppearanceState>) {
  actorValid(actor);
  integer(state.currentCharaSize, 1, "current size");
  integer(state.nowCharaSize, 1, "selected size");
  if (state.currentCharaSize !== actor.sizeType)
    throw new Error("Battle appearance actor/state identity mismatch");
  if (state.magitek) {
    integer(state.magitek.conditionId, 1, "condition identity");
    integer(state.magitek.backCharaSize, 1, "backup size");
  }
  vector(state.textureOffset, "texture offset"); vector(state.position, "position");
  if (typeof state.backAnimKey !== "string") throw new Error("Invalid battle appearance animation cache");
  integer(state.backSpriteIndex, -1, "animation index");
}
function conditionTypes(catalog: BattleAppearanceCatalog, ids: readonly number[]) {
  if (catalog.kind !== "source-magitek") throw new Error("Unknown battle appearance provider");
  const definitions = new Map(catalog.conditions.map((row) => [row.id, row.type]));
  if (definitions.size !== catalog.conditions.length || definitions.get(catalog.conditionId) !== 607)
    throw new Error("Invalid battle appearance condition catalog");
  return ids.map((id) => {
    const type = definitions.get(id);
    if (type === undefined) throw new Error("Unknown battle appearance condition: " + id);
    return type;
  });
}

/** SelectedCharaSize 0x92c440, the complete active-607 branch. This arithmetic
 * helper does not admit Mog/Kappa or implement their separate Start/Remove. */
export function selectMagitekCharaSize(
  rules: BattleAppearanceCatalog["sizeRules"], base: number, types: readonly number[],
): number {
  integer(base, 1, "base size");
  integer(rules.mog, 0, "Mog posture");
  integer(rules.magitekOffset, 0, "Magitek posture offset");
  integer(rules.magitekKappa, 1, "Magitek Kappa posture");
  if (!types.includes(607)) throw new Error("Magitek posture needs an active source condition");
  const selected = types.includes(601) ? rules.magitekKappa :
    (types.includes(681) && rules.mog > 0 ? rules.mog : base) + rules.magitekOffset;
  integer(selected, 1, "selected size");
  return selected;
}

export function createBattleAppearanceState(actor: BattleAppearanceActor): BattleAppearanceState {
  actorValid(actor);
  return { currentCharaSize: actor.sizeType, nowCharaSize: actor.sizeType,
    magitek: null, textureOffset: { x: 0, y: 0 }, position: { x: 0, y: 0 },
    backAnimKey: "", backSpriteIndex: -1 };
}

/** Start saves the prior effect posture once. Death/revival is not removal;
 * the source conflict catalog decides whether 607 remains in conditionIds. */
export function reconcileBattleAppearance(
  catalog: BattleAppearanceCatalog, actor: BattleAppearanceActor,
  state: Readonly<BattleAppearanceState>, conditionIds: readonly number[],
): BattleAppearanceState {
  stateValid(actor, state);
  const types = conditionTypes(catalog, conditionIds);
  if (types.some((type) => [401, 402, 403, 601, 681].includes(type)))
    throw new Error("Unimplemented transformed battle appearance lifecycle");
  const active = conditionIds.filter((_, index) => types[index] === 607);
  if (active.length > 1 || active.some((id) => id !== catalog.conditionId))
    throw new Error("Multiple or unbound Magitek conditions");
  if (state.magitek && state.magitek.conditionId !== catalog.conditionId)
    throw new Error("Battle appearance Magitek identity mismatch");
  const next: BattleAppearanceState = structuredClone(state);
  if (active.length && !state.magitek) {
    next.magitek = { conditionId: catalog.conditionId, backCharaSize: state.nowCharaSize };
    next.nowCharaSize = selectMagitekCharaSize(catalog.sizeRules, state.currentCharaSize, types);
    // ChangeRideOnMagicArmor(true) invalidates the body pose cache.
    next.backAnimKey = ""; next.backSpriteIndex = -1;
  } else if (!active.length && state.magitek) {
    next.nowCharaSize = state.magitek.backCharaSize; next.magitek = null;
    // The same frame's UpdateCharacterAnimation resets these when ride=false.
    next.textureOffset = { x: 0, y: 0 }; next.position = { x: 0, y: 0 };
  }
  return next;
}

function layer(
  name: string, mapping: Record<string, string>, geometry: Record<string, BattleAppearanceGeometry>,
  sprites: Readonly<Record<string, { width: number; height: number }>>,
  position: AppearanceVector, offset: AppearanceVector,
): BattleAppearanceLayer {
  const key = mapping[name], shape = geometry[name];
  const sprite = key ? sprites[key] : undefined;
  if (!key || !shape || !sprite) throw new Error("Missing battle appearance media: " + name);
  if (!Number.isInteger(shape.width) || shape.width <= 0 || shape.width % 2 !== 0 ||
      !Number.isInteger(shape.height) || shape.height <= 0 ||
      shape.pixelsPerUnit !== 1 || shape.pivot[0] !== 0.5 || shape.pivot[1] !== 0 ||
      shape.textureWrap[0] !== 1 || shape.textureWrap[1] !== 1 || shape.filterMode !== 0 ||
      sprite.width !== shape.width || sprite.height !== shape.height)
    throw new Error("Unresolved battle appearance media geometry: " + name);
  return { sprite: key, width: shape.width, height: shape.height,
    position: { ...position }, textureOffset: { ...offset } };
}

/** No modulo/clamp of frame indices. Short offset/position tables retain their
 * previous values, independently, as UpdateCharacterAnimation 0x158d160 does. */
export function projectBattleAppearanceFrame(
  catalog: BattleAppearanceCatalog, actor: BattleAppearanceActor,
  state: Readonly<BattleAppearanceState>,
  frame: { key: string; bodyFrame: number; armorFrame: number },
  sprites: Readonly<Record<string, { width: number; height: number }>>,
): { state: BattleAppearanceState; projection: BattleAppearanceProjection } {
  stateValid(actor, state);
  integer(frame.bodyFrame, 0, "body frame"); integer(frame.armorFrame, 0, "armor frame");
  const alias = catalog.aliases[frame.key];
  if (!alias || !alias.body[frame.bodyFrame])
    throw new Error("Unresolved battle appearance body frame: " + frame.key);
  const next: BattleAppearanceState = structuredClone(state);
  if (state.magitek) {
    if (state.magitek.conditionId !== catalog.conditionId)
      throw new Error("Battle appearance Magitek identity mismatch");
    if (frame.key !== state.backAnimKey || frame.bodyFrame !== state.backSpriteIndex) {
      const offset = alias.textureOffsets[frame.bodyFrame], position = alias.positions[frame.bodyFrame];
      if (offset) { vector(offset, "alias texture offset"); next.textureOffset = { ...offset }; }
      if (position) { vector(position, "alias position"); next.position = { ...position }; }
      next.backAnimKey = frame.key; next.backSpriteIndex = frame.bodyFrame;
    }
  } else {
    next.textureOffset = { x: 0, y: 0 }; next.position = { x: 0, y: 0 };
  }
  const body = layer(alias.body[frame.bodyFrame]!, actor.bodySprites, actor.bodyGeometry,
    sprites, next.position, next.textureOffset);
  let armor: BattleAppearanceLayer | null = null;
  if (next.magitek) {
    const name = alias.armor[frame.armorFrame];
    if (!name) throw new Error("Unresolved battle appearance armor frame: " + frame.key);
    armor = layer(name, catalog.armorSprites, catalog.armorGeometry, sprites,
      { x: 0, y: 0 }, { x: 0, y: 0 });
  }
  return { state: next, projection: { ...frame, charaSize: next.nowCharaSize,
    orientation: "source-alias", body, armor } };
}

export type BattleAppearanceQuad = {
  source: { x: number; y: number; width: number; height: number };
  destination: { x: number; y: number; width: number; height: number };
};
/** Canvas equivalent of the source full-rect, bottom-center mesh's point/Clamp
 * sampling. Edge strips repeat the edge texel; transparency is never assumed.
 * Returned destination coordinates use pixels, x right and y down. */
export function battleAppearanceQuads(layer: BattleAppearanceLayer): BattleAppearanceQuad[] {
  integer(layer.width, 1, "quad width"); integer(layer.height, 1, "quad height");
  vector(layer.position, "quad position"); vector(layer.textureOffset, "quad offset");
  const axis = (length: number, offset: number) => {
    const boundaries = [...new Set([0, length,
      Math.max(0, Math.min(length, -offset)),
      Math.max(0, Math.min(length, length - offset))])].sort((a, b) => a - b);
    return boundaries.slice(0, -1).map((start, index) => {
      const end = boundaries[index + 1]!, center = (start + end) / 2 + offset;
      return { start, length: end - start,
        source: center < 0 ? 0 : center >= length ? length - 1 : start + offset,
        sourceLength: center < 0 || center >= length ? 1 : end - start };
    });
  };
  const xs = axis(layer.width, layer.textureOffset.x * layer.width);
  const ys = axis(layer.height, -layer.textureOffset.y * layer.height);
  return xs.flatMap((x) => ys.map((y) => ({
    source: { x: x.source, y: y.source, width: x.sourceLength, height: y.sourceLength },
    destination: { x: layer.position.x - Math.trunc(layer.width / 2) + x.start,
      y: -layer.position.y - layer.height + y.start, width: x.length, height: y.length },
  })));
}
