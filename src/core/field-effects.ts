import type { Evidence } from "../field/types.js";

export type FieldEffectPoint = { x: number; y: number; z: number };
/** A kind 11 object is a board. It is not a physical character or a particle
 * system. Pixel coordinates remain in the source entity-group coordinate space. */
export type FieldEffectBoardDefinition = {
  kind: "source-field-effect-board-v1";
  assetId: number; assetGroup: string; assetName: "Prefabs/EffectPrefab";
  pixelPosition: { x: number; y: number }; pixelSize: { width: number; height: number };
  playOnAwake: boolean; front: boolean; split: boolean; zOffset: number;
  affected: boolean; blendType: number; zTest: 4 | 8;
  collision: boolean; building: boolean; birdviewPuppet: boolean; screen: boolean;
  visibleMinimap: boolean; source: Evidence;
};
export type FieldEffectMediaDefinition = {
  kind: "source-field-effect-media-v1"; assetGroup: string; source: Evidence;
  orthographicSize: number; renderTexture: { width: number; height: number; filterMode: 0; wrapMode: 1 };
  particles: { id: string; loop: boolean; enabledModules: string[] }[];
  animator: null;
  /** Extraction and lifecycle recovery are not particle/shader admission. */
  blockers: string[];
};
export type FieldEffectCatalog = { media: Record<string, FieldEffectMediaDefinition> };
export type FieldEffectMesh = {
  vertices: FieldEffectPoint[]; uv: { x: number; y: number }[]; triangles: number[];
  renderQueue: number; affectedMode: 0 | 2; zTest: 4 | 8; blendType: number;
  collider: { enabled: boolean; width: number; height: number };
};
export type FieldEffectBoardState = {
  id: string; definition: FieldEffectBoardDefinition; cameraId: number;
  position: FieldEffectPoint; mesh: FieldEffectMesh;
  activeSelf: boolean; fadeAlpha: number; currentFadeStatus: 0;
};
export type FieldEffectPlayerState = {
  cameraId: number; assetGroup: string; references: number; autoPlaying: boolean;
  activeSelf: boolean; effectActive: boolean; playing: boolean;
  loopLimit: number; loopCount: number; elapsedSec: number; positionY: number;
};
export type FieldEffectState = {
  kind: "field-effects-v1"; instanceCount: number; nextParticlePositionY: number;
  players: FieldEffectPlayerState[]; boards: FieldEffectBoardState[];
  /** Native release removes created/refcount entries but leaves this dictionary.
   * A dangling shared entry cannot be silently replaced by a new instance. */
  shared: Record<string, number>; registeredCameraIds: number[];
};
export type FieldEffectObservation = { cameraId: number; particlePlaying: boolean[] };
export type FieldEffectOperation =
  | { kind: "create"; id: string; definition: FieldEffectBoardDefinition; position: FieldEffectPoint }
  | { kind: "destroy"; id: string }
  /** MapModel group enable changes GameObject.activeSelf without Show/Hide. */
  | { kind: "active"; id: string; active: boolean }
  | { kind: "visibility"; id: string; visible: boolean; duration: number }
  | { kind: "play"; id: string; loopLimit: number }
  | { kind: "stop"; id: string }
  | { kind: "setup"; registeredBoards: string[]; groupUpdate: boolean }
  | { kind: "tick"; deltaSeconds: number; observations: FieldEffectObservation[] };
export type FieldEffectEvent =
  | { kind: "create-player" | "destroy-player" | "clear-render-texture" | "restart" | "stop" | "show-player" | "hide-player"; cameraId: number }
  | { kind: "register" | "unregister"; cameraIds: number[] }
  | { kind: "elapsed"; cameraId: number; seconds: number };
export type FieldEffectPlan = { before: FieldEffectState; after: FieldEffectState; events: FieldEffectEvent[] };
export type FieldEffectPublication = { validate(): void; commit(): void };
/** The host must prepare all particle, material and board changes without
 * publishing. commit only installs already-prepared state and cannot fail. */
export type FieldEffectProvider = { prepare(plan: Readonly<FieldEffectPlan>): FieldEffectPublication };
/** observe prepares read-only playback observations for the next update. Any
 * particle/texture work is staged by prepare and installed only by commit. */
export type FieldEffectRuntimeHost = FieldEffectProvider & {
  observe(state: Readonly<FieldEffectState>, deltaSeconds: number): FieldEffectObservation[];
};
/** FieldEffectParticleEntity.GetUpdateAttribute (9eb2f0): Field | Message | FieldReady. */
export const FIELD_EFFECT_PARTICLE_UPDATE_ATTRIBUTE = 42;
export function fieldEffectUpdateAllowed(mask: number): boolean {
  integer(mask, 0); return (mask & FIELD_EFFECT_PARTICLE_UPDATE_ATTRIBUTE) !== 0;
}
export type FieldEffectPrepared = FieldEffectPublication & { readonly state: FieldEffectState };

const f = Math.fround;
function finite(value: number): void {
  if (!Number.isFinite(value) || !Number.isFinite(f(value))) throw new Error("Invalid field effect number");
}
function integer(value: number, min = -2147483648): void {
  if (!Number.isInteger(value) || value < min || value > 2147483647) throw new Error("Invalid field effect integer");
}
function identity(value: string): void {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new Error("Missing field effect identity");
}
function point(value: FieldEffectPoint): void { if (!value) throw new Error("Missing effect position"); [value.x, value.y, value.z].forEach(finite); }

export function validateFieldEffectBoard(definition: FieldEffectBoardDefinition): void {
  if (!definition || definition.kind !== "source-field-effect-board-v1" || definition.assetName !== "Prefabs/EffectPrefab")
    throw new Error("Unknown field effect board definition");
  identity(definition.assetGroup); integer(definition.assetId, 1);
  integer(definition.pixelPosition.x); integer(definition.pixelPosition.y);
  integer(definition.pixelSize.width, 1); integer(definition.pixelSize.height, 1);
  integer(definition.zOffset); integer(definition.blendType, 0);
  for (const value of [definition.playOnAwake, definition.front, definition.split, definition.affected,
    definition.collision, definition.building, definition.birdviewPuppet, definition.screen, definition.visibleMinimap])
    if (typeof value !== "boolean") throw new Error("Unknown field effect property");
  if (![4, 8].includes(definition.zTest)) throw new Error("Unknown field effect depth comparison");
}
export function fieldEffectBoardBlockers(definition: FieldEffectBoardDefinition): string[] {
  validateFieldEffectBoard(definition);
  const blockers = [];
  if (definition.building) blockers.push("Field effect building interaction provider is unavailable");
  if (definition.collision) blockers.push("Field effect collider host is unavailable");
  if (definition.birdviewPuppet) blockers.push("Field effect birdview scale provider is unavailable");
  if (definition.screen) blockers.push("Field effect screen-space provider is unavailable");
  if (definition.visibleMinimap) blockers.push("Field effect minimap provider is unavailable");
  if (definition.blendType !== 0) blockers.push("Field effect blend table provider is unavailable");
  return blockers;
}
/** MapObjectGroup.LoadGroup b27340 and CreateOutOfRangeMapPosition 309e30.
 * This is entity-object placement, not Puppet ChangeLayer's narrower mapping.
 * A source property at the top edge y=0 is out of range. Front/ZOffset affect
 * the local board mesh, and must not be added to this entity transform twice. */
export function projectFieldEffectPlacement(definition: FieldEffectBoardDefinition,
  map: { range: { x: number; y: number; width: number; height: number };
    tileMapPresent: boolean; standbyAnchor: { x: number; y: number } | null }, logicalLayer: number,
): { position: FieldEffectPoint; layer: number; tilePosition: { x: number; y: number } } {
  validateFieldEffectBoard(definition);
  const range = map.range;
  integer(range.x); integer(range.y); integer(range.width, 1); integer(range.height, 1); integer(logicalLayer, 0);
  if (logicalLayer > 3 || typeof map.tileMapPresent !== "boolean") throw new Error("Unknown field effect map/layer binding");
  const layer = logicalLayer + 9, z = [349, 249, 149, 49][logicalLayer]!;
  // Property placement performs signed int32 arithmetic before float conversion.
  // Out-of-range inputs are not silently promoted to a different double formula.
  const i32 = (value: number) => { integer(value); return value; };
  const x = f(i32(definition.pixelPosition.x - i32(range.x * 16))), y = f(i32(definition.pixelPosition.y - i32(range.y * 16)));
  i32(range.width * 8); i32(range.height * 8);
  let position = { x: f(f(x - range.width * 8) + Math.trunc(definition.pixelSize.width / 2)),
    y: f(f(range.height * 8 - y) + Math.trunc(definition.pixelSize.height / 2)), z };
  if (definition.screen) return { position: { x: 0, y: 0, z: 49 }, layer: 12, tilePosition: { x, y } };
  if (map.tileMapPresent && (f(x * 0.0625) < 0 || f(x * 0.0625) >= range.width ||
      f(y * 0.0625) <= 0 || f(y * 0.0625) > range.height)) {
    if (!map.standbyAnchor) throw new Error("Field effect standby anchor provider is unavailable");
    finite(map.standbyAnchor.x); finite(map.standbyAnchor.y);
    position = { x: f(map.standbyAnchor.x), y: f(map.standbyAnchor.y), z };
  }
  return { position, layer, tilePosition: { x, y } };
}
function media(catalog: FieldEffectCatalog, group: string, admit = true): FieldEffectMediaDefinition {
  const result = catalog?.media[group];
  if (!result || result.kind !== "source-field-effect-media-v1" || result.assetGroup !== group)
    throw new Error("Field effect media provider is unavailable: " + group);
  finite(result.orthographicSize);
  if (result.orthographicSize <= 0 || result.animator !== null || !Array.isArray(result.particles) || !Array.isArray(result.blockers))
    throw new Error("Unsupported field effect media structure");
  const size = Math.trunc(f(f(result.orthographicSize) * 2));
  if (size < 1 || size > 8192 || result.renderTexture.width !== size || result.renderTexture.height !== size ||
      result.renderTexture.filterMode !== 0 || result.renderTexture.wrapMode !== 1)
    throw new Error("Unbound field effect render texture");
  if (new Set(result.particles.map((p) => p.id)).size !== result.particles.length ||
      result.particles.some((p) => !p.id || typeof p.loop !== "boolean" || !Array.isArray(p.enabledModules)))
    throw new Error("Invalid effect particle identity");
  if (admit && result.blockers.length) throw new Error("Field effect particle provider unavailable: " + group + ": " + result.blockers.join("; "));
  return result;
}

/** Native 0x87dc90, including its source signed remainder and degenerate tail
 * strips. Do not replace this with equally sized quads or skip zero-area rows. */
export function projectFieldEffectBoard(definition: FieldEffectBoardDefinition,
  renderTexture: Readonly<{ width: number; height: number }>): FieldEffectMesh {
  validateFieldEffectBoard(definition);
  const width = renderTexture.width, height = renderTexture.height;
  integer(width, 1); integer(height, 1);
  if (width > 8192 || height > 8192) throw new Error("Effect board exceeds supported mesh size");
  let count = Math.ceil(f(height * 0.0625));
  if (count % 2 === 0) count++;
  let bottom = count * 8 - 16;
  let z = definition.zOffset < 0 ? 0 : definition.zOffset < 2 ? -2 * definition.zOffset + 0.25 : -2 * definition.zOffset;
  const remainder = definition.pixelPosition.y % 16;
  if (remainder > 0) {
    bottom += remainder;
    const quotient = Math.trunc(bottom / 16);
    bottom -= quotient * 16; count++; z = f(z - quotient * 2);
  }
  if (!definition.split) { count = 1; bottom = -Math.trunc(height / 2); }
  const vertices: FieldEffectPoint[] = [], uv: { x: number; y: number }[] = [], triangles: number[] = [];
  const x = -Math.trunc(width / 2), half = f(height * 0.5);
  let consumed = 0;
  for (let index = 0; index < count; index++) {
    const depth = definition.birdviewPuppet ? z : f((index - Math.floor(f(count * 0.5))) * -2 + z);
    const top = f(half - consumed), base = vertices.length;
    vertices.push({ x, y: top, z: depth }, { x: f(x + width), y: top, z: depth },
      { x, y: bottom, z: depth }, { x: f(x + width), y: bottom, z: depth });
    const topUV = f(1 - f(f(half - top) / height)), bottomUV = f(1 - f(f(half - bottom) / height));
    uv.push({ x: 0, y: topUV }, { x: 1, y: topUV }, { x: 0, y: bottomUV }, { x: 1, y: bottomUV });
    triangles.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    consumed += Math.trunc(f(top - bottom));
    bottom -= 16;
    if (bottom < -half) bottom = -Math.trunc(height / 2);
  }
  return { vertices, uv, triangles, renderQueue: definition.front ? (definition.affected ? 2458 : 2460) : 2453,
    affectedMode: definition.affected ? 0 : 2, zTest: definition.zTest, blendType: definition.blendType,
    collider: { enabled: definition.collision, width: definition.pixelSize.width - 2, height: definition.pixelSize.height - 2 } };
}

export function createFieldEffectState(): FieldEffectState {
  return { kind: "field-effects-v1", instanceCount: 0, nextParticlePositionY: 0,
    players: [], boards: [], shared: {}, registeredCameraIds: [] };
}
/** FieldEffectBoardEntity.PlayAnimation's string overload (87f320) ignores
 * the animation key, timeScale and flip. Only Nullable<int> mode is read:
 * explicit mode 0 means one playback; every other/absent value means automatic
 * loop selection. This is different from the direct integer loopLimit overload. */
export function fieldEffectAnimationLoopLimit(mode: number | null): number {
  if (mode !== null) integer(mode);
  return mode === 0 ? 1 : 0;
}
export function validateFieldEffectState(state: FieldEffectState, catalog: FieldEffectCatalog): void {
  if (!state || state.kind !== "field-effects-v1" || !Array.isArray(state.players) || !Array.isArray(state.boards))
    throw new Error("Invalid field effect state");
  integer(state.instanceCount, 0); finite(state.nextParticlePositionY);
  if (new Set(state.boards.map((b) => b.id)).size !== state.boards.length ||
      new Set(state.players.map((p) => p.cameraId)).size !== state.players.length) throw new Error("Duplicate effect owner");
  for (const player of state.players) {
    integer(player.cameraId, 1); integer(player.references, 1); integer(player.loopCount, 0); integer(player.loopLimit, 0);
    finite(player.elapsedSec); finite(player.positionY); media(catalog, player.assetGroup);
    if (player.cameraId > state.instanceCount || player.elapsedSec < 0 ||
        [player.autoPlaying, player.activeSelf, player.effectActive, player.playing].some((v) => typeof v !== "boolean") ||
        player.references !== state.boards.filter((b) => b.cameraId === player.cameraId).length)
      throw new Error("Invalid effect player ownership");
  }
  for (const board of state.boards) {
    identity(board.id); point(board.position); validateFieldEffectBoard(board.definition);
    const player = state.players.find((p) => p.cameraId === board.cameraId);
    if (!player || player.assetGroup !== board.definition.assetGroup || board.currentFadeStatus !== 0 ||
        typeof board.activeSelf !== "boolean" || ![0, 1].includes(board.fadeAlpha)) throw new Error("Invalid effect board ownership");
    const expected = projectFieldEffectBoard(board.definition, media(catalog, player.assetGroup).renderTexture);
    if (JSON.stringify(expected) !== JSON.stringify(board.mesh)) throw new Error("Changed effect board mesh");
  }
  for (const [group, id] of Object.entries(state.shared)) {
    integer(id, 1); identity(group);
    const player = state.players.find((p) => p.cameraId === id);
    if (id > state.instanceCount || (player && (!player.autoPlaying || player.assetGroup !== group))) throw new Error("Invalid shared effect identity");
  }
  if (new Set(state.registeredCameraIds).size !== state.registeredCameraIds.length ||
      state.registeredCameraIds.some((id) => !state.players.some((p) => p.cameraId === id)))
    throw new Error("Invalid registered effect players");
}

export function projectFieldEffects(state: FieldEffectState, catalog: FieldEffectCatalog,
  operations: readonly FieldEffectOperation[]): FieldEffectPlan {
  validateFieldEffectState(state, catalog);
  const next = structuredClone(state), events: FieldEffectEvent[] = [];
  const board = (id: string) => { const b = next.boards.find((b) => b.id === id); if (!b) throw new Error("Unknown effect board: " + id); return b; };
  const player = (id: number) => { const p = next.players.find((p) => p.cameraId === id); if (!p) throw new Error("Released or unknown effect player: " + id); return p; };
  const stop = (p: FieldEffectPlayerState) => { p.playing = false; p.effectActive = false; events.push({ kind: "stop", cameraId: p.cameraId }); };
  const play = (p: FieldEffectPlayerState, limit: number) => {
    integer(limit); const source = media(catalog, p.assetGroup);
    p.effectActive = true; p.playing = true; p.loopCount = 0;
    p.loopLimit = limit > 0 ? limit : source.particles.some((particle) => particle.loop) ? 0 : 1;
    // Native PlayEffect does not reset elapsedSec; shader time survives restart.
    events.push({ kind: "restart", cameraId: p.cameraId });
  };
  for (const op of operations) {
    switch (op.kind) {
      case "create": {
        identity(op.id); point(op.position);
        if (next.boards.some((b) => b.id === op.id)) throw new Error("Duplicate effect board: " + op.id);
        const d = op.definition, blocked = fieldEffectBoardBlockers(d);
        if (blocked.length) throw new Error(blocked.join("; "));
        const m = media(catalog, d.assetGroup), sharedId = d.playOnAwake ? next.shared[d.assetGroup] : undefined;
        let p: FieldEffectPlayerState;
        if (sharedId !== undefined) p = player(sharedId);
        else {
          const id = ++next.instanceCount;
          next.nextParticlePositionY = f(next.nextParticlePositionY + f(m.orthographicSize));
          p = { cameraId: id, assetGroup: d.assetGroup, references: 0, autoPlaying: d.playOnAwake,
            activeSelf: false, effectActive: d.playOnAwake, playing: false, loopCount: 0, loopLimit: 0,
            elapsedSec: 0, positionY: next.nextParticlePositionY };
          next.nextParticlePositionY = f(f(next.nextParticlePositionY + f(m.orthographicSize)) + 100);
          next.players.push(p); if (d.playOnAwake) next.shared[d.assetGroup] = id;
          events.push({ kind: "create-player", cameraId: id });
        }
        p.references++;
        next.boards.push({ id: op.id, definition: structuredClone(d), cameraId: p.cameraId, position: structuredClone(op.position),
          mesh: projectFieldEffectBoard(d, m.renderTexture), activeSelf: d.playOnAwake, fadeAlpha: d.playOnAwake ? 1 : 0, currentFadeStatus: 0 });
        events.push({ kind: "clear-render-texture", cameraId: p.cameraId }); break;
      }
      case "destroy": {
        const b = board(op.id), p = player(b.cameraId);
        next.boards = next.boards.filter((b) => b.id !== op.id);
        if (--p.references === 0) {
          next.players = next.players.filter((p) => p.cameraId !== b.cameraId);
          next.registeredCameraIds = next.registeredCameraIds.filter((id) => id !== b.cameraId);
          events.push({ kind: "destroy-player", cameraId: b.cameraId });
        }
        break;
      }
      case "active": {
        if (typeof op.active !== "boolean") throw new Error("Unknown field effect group activity");
        board(op.id).activeSelf = op.active; break;
      }
      case "visibility": {
        if (typeof op.visible !== "boolean" || op.duration !== 0) throw new Error("Field effect nonzero fade is not implemented");
        const b = board(op.id); b.activeSelf = op.visible; b.fadeAlpha = op.visible ? 1 : 0; break;
      }
      case "play": play(player(board(op.id).cameraId), op.loopLimit); break;
      case "stop": stop(player(board(op.id).cameraId)); break;
      case "setup": {
        if (typeof op.groupUpdate !== "boolean" || new Set(op.registeredBoards).size !== op.registeredBoards.length)
          throw new Error("Invalid field effect registration");
        events.push({ kind: "unregister", cameraIds: [...next.registeredCameraIds] });
        const selected = [...new Set(op.registeredBoards.map((id) => board(id).cameraId))];
        for (const id of selected) {
          const p = player(id); p.activeSelf = true; events.push({ kind: "show-player", cameraId: id });
          if (p.autoPlaying && !p.playing) play(p, -1);
        }
        if (!op.groupUpdate) for (const p of next.players) if (!selected.includes(p.cameraId)) {
          stop(p); p.activeSelf = false; events.push({ kind: "hide-player", cameraId: p.cameraId });
        }
        next.registeredCameraIds = selected; events.push({ kind: "register", cameraIds: [...selected] }); break;
      }
      case "tick": {
        finite(op.deltaSeconds); if (op.deltaSeconds < 0) throw new Error("Negative field effect delta");
        const updating = next.registeredCameraIds.map(player).filter((p) => p.activeSelf && p.playing);
        if (op.observations.length !== updating.length || new Set(op.observations.map((o) => o.cameraId)).size !== op.observations.length)
          throw new Error("Missing/duplicate field effect observations");
        for (const p of updating) {
          const observation = op.observations.find((o) => o.cameraId === p.cameraId), m = media(catalog, p.assetGroup);
          if (!observation || observation.particlePlaying.length !== m.particles.length || observation.particlePlaying.some((v) => typeof v !== "boolean"))
            throw new Error("Unknown particle playback state");
          p.elapsedSec = f(p.elapsedSec + f(op.deltaSeconds));
          events.push({ kind: "elapsed", cameraId: p.cameraId, seconds: p.elapsedSec });
          // UpdateEntity only counts non-looping particles' isPlaying. A looped
          // emitter does not defer a caller-specified positive loop limit.
          if (p.loopLimit > 0 && !m.particles.some((particle, i) => !particle.loop && observation.particlePlaying[i])) {
            p.loopCount++; stop(p);
            if (p.loopCount < p.loopLimit) { p.effectActive = true; p.playing = true; events.push({ kind: "restart", cameraId: p.cameraId }); }
          }
        }
        break;
      }
      default: throw new Error("Unknown field effect operation");
    }
  }
  validateFieldEffectState(next, catalog);
  return { before: structuredClone(state), after: next, events };
}

/** Single manager owner. Preparation is disposable and all ordered operations
 * share one candidate. A stale provider/owner is rejected before any publish. */
export class FieldEffects {
  #state = createFieldEffectState();
  #revision = 0;
  readonly #catalog: FieldEffectCatalog;
  readonly #provider: FieldEffectProvider | undefined;
  constructor(catalog: FieldEffectCatalog, provider?: FieldEffectProvider) {
    this.#catalog = structuredClone(catalog); this.#provider = provider;
  }
  snapshot(): FieldEffectState { return structuredClone(this.#state); }
  prepare(operations: readonly FieldEffectOperation[]): FieldEffectPrepared {
    const plan = projectFieldEffects(this.#state, this.#catalog, operations), revision = this.#revision;
    if (!this.#provider) throw new Error("Field effect renderer/particle host is unavailable");
    const publication = this.#provider.prepare(structuredClone(plan));
    let used = false;
    const validate = () => {
      if (used || this.#revision !== revision) throw new Error("Stale field effect publication");
      publication.validate();
    };
    return { get state() { return structuredClone(plan.after); }, validate, commit: () => {
      validate(); publication.commit(); this.#state = plan.after; this.#revision++; used = true;
    } };
  }
}
