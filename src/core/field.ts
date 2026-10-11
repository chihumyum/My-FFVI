import type {
  Direction,
  FieldContent,
  FieldEntity,
  FieldMessage,
  Op,
  Point,
  Site,
  MapRequest,
} from "../field/types.js";
import {
  EventState,
  executeEventControl,
  type EventStateSnapshot,
} from "./event-state.js";
import {
  executeInventoryEvent,
  type FieldInventoryPort,
  type FieldInventoryTransaction,
} from "./inventory-event.js";
import { executePartyEvent, type FieldPartyPort, type PartyAppearanceCandidate } from "./party.js";
import { executeOwnedConditionEvent, type FieldOwnedConditionPort } from "./owned-condition.js";
import type { PartyActorPlan } from "./party-actors.js";
import type { FieldTreasurePort } from "./treasure-port.js";
import { treasureFlagRef, validateTreasureInventory, type TreasureBoxRequest } from "./treasure-inventory.js";
import { createTreasureTask, advanceTreasureTask, type TreasureTaskState, type TreasureTaskInput } from "./treasure-task.js";
import type { PartyActorCatalog } from "./party-actors.js";
import { FieldPartyActors, type FieldPartyActorCheckpoint } from "./field-party-actors.js";
import { missingFieldPoses } from "./character-media.js";
import { executeRosterLifecycleEvent, type FieldRosterPort } from "./roster.js";
import type { FieldConditionPort } from "./field-conditions.js";
import { projectFieldEntryContext } from "./field-entry-context.js";
import { requireMinimapMedia } from "./minimap.js";
import { StaticAudioState, type AudioSnapshot } from "./static-audio.js";
import { TileAnimationState, type TileCheckpoint } from "./tile-animation.js";
import {
  OpenTriggerState,
  type OpenTriggerCheckpoint,
} from "./open-trigger.js";
import {
  ActorAnimation,
  FIELD_POSE,
  type ActorPlayback,
} from "./actor-animation.js";
import {
  checkpointKeys,
  checkpointNumber,
  checkpointInteger,
  checkpointIds,
  checkpointSameIds,
} from "./checkpoint-validation.js";
import {
  buildCollisionMapping,
  collisionMask,
  diagonalBit,
  fieldCollisionRange,
  inCollisionRange,
  redirectAtSlope,
  type CollisionRange,
} from "./collision.js";
export const DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
const BIT: Record<Direction, number> = { up: 1, left: 2, right: 4, down: 8 };
const ACTION_SIDE: Record<Direction, number> = {
  up: 1,
  right: 2,
  down: 4,
  left: 8,
};
const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  left: "right",
  right: "left",
  down: "up",
};
export type Motion = {
  from: Point;
  to: Point;
  elapsed: number;
  duration: number;
  manual: boolean;
};
export type Actor = Point & {
  id: string;
  layer: number;
  direction: Direction;
  asset: string;
  mount: string | null;
  motion: Motion | null;
  steps: number;
  animation: ActorAnimation | null;
};
export type FieldCheckpoint = {
  kind: "idle-field-v5";
  contentHash: string;
  time: number;
  remainder: number;
  nextTask: number;
  transportationId: number | null;
  entrySynchronized: boolean | null;
  partyActors: FieldPartyActorCheckpoint | null;
  eventState: EventStateSnapshot;
  activeGroups: string[];
  hiddenEntities: string[];
  openedTreasures: string[];
  actors: (Omit<Actor, "motion" | "animation"> & {
    animation: ActorPlayback | null;
  })[];
  tiles: TileCheckpoint;
  doors: OpenTriggerCheckpoint;
  bgm: AudioSnapshot;
  environment: AudioSnapshot;
};
type Task = {
  id: number;
  script: string;
  pc: number;
  stack: number[];
  actor: string;
  wait: number;
  children: number[];
  pending: { slot: number; actor: string; target: number }[];
  remaining: number;
  move: Extract<Op, { kind: "move" }> | null;
  animationWait: boolean;
  treasure: { state: TreasureTaskState; entity: FieldEntity; site: Site;
    closeMessage: boolean; messageAvailableAt: number } | null;
  treasureRoot: boolean;
  done: boolean;
};
export type MapTransitionStop = {
  kind: "map-transition";
  message: string;
  site: Site | null;
  request: MapRequest;
};
export type Stop =
  | MapTransitionStop
  | {
      kind: "unsupported" | "encounter";
      message: string;
      site: Site | null;
      party?: number;
      continuation?: string;
    };
export type Dialogue = FieldMessage & { task: number };
export type FieldGameOptions = {
  /** Read-only admission before any shop greeting or interaction is published. */
  shop?: { validate(groupId: number): void };
  ownedConditions?: FieldOwnedConditionPort;
  inventory?: FieldInventoryPort;
  treasure?: FieldTreasurePort;
  party?: FieldPartyPort;
  roster?: FieldRosterPort;
  fieldSteps?: FieldConditionPort;
  partyAppearance?: { catalog: PartyActorCatalog; current(): PartyAppearanceCandidate };
  /** Read the current owned-state draft; unsupported step effects must not disappear. */
  movementBlocker?: (transportationId: number | null, manual: boolean) => string | null;
};
const contains = (e: FieldEntity, p: Point) =>
  p.x >= e.x && p.x < e.x + e.width && p.y >= e.y && p.y < e.y + e.height;
export class FieldGame {
  readonly transportationId: number | null;
  readonly cameraOffset: Readonly<Point>;
  private readonly partyActors: FieldPartyActors | null;
  readonly tileAnimations: TileAnimationState;
  readonly openTriggers: OpenTriggerState;
  readonly collisionRange: CollisionRange;
  private readonly collisionMappings = new Map<number, number[]>();
  readonly actors: Record<string, Actor> = {};
  readonly hiddenEntities = new Set<string>();
  private readonly openedTreasures = new Set<string>();
  readonly activeGroups = new Set<string>();
  private readonly entityList: FieldEntity[];
  private readonly defaultProperties: readonly FieldEntity[];
  private currentProperties: readonly FieldEntity[];
  get entities(): readonly FieldEntity[] {
    return this.entityList;
  }
  /** Source minimap queries current properties (default + latest event group), not all spawned bodies. */
  get minimapEntities(): readonly FieldEntity[] {
    return this.currentProperties;
  }
  get flags(): Record<string, Record<string, boolean>> {
    return this.eventState.flagView();
  }
  readonly presentationOmissions: {
    site: Site;
    kind: "sound" | "sound-sync";
    soundId: number | null;
  }[] = [];
  fade: { elapsed: number; duration: number } | null = null;
  dialogue: Dialogue | null = null;
  private retainedMessage: Dialogue | null = null;
  private treasureSceneState: "player" | "message" = "player";
  /** A close=false source message keeps its window during the post-input yield. */
  get messageWindow(): Dialogue | null { return this.dialogue ?? this.retainedMessage; }
  stop: Stop | null = null;
  time = 0;
  private tasks: Task[] = [];
  private remainder = 0;
  private nextTask = 1;
  private synchronizedEntry: boolean | null = null;
  private entryTaskStarted = false;
  private pendingPlayerStep: ReturnType<FieldConditionPort["prepareStep"]> | null = null;
  private interaction: {
    entityId: string;
    restoreDirection: Direction | null;
    waitUntil: number;
  } | null = null;
  private shopTask: {
    id: number;
    groupId: number;
    entityId: string;
    stage: "greeting" | "open" | "farewell";
    close: FieldMessage | null;
  } | null = null;
  /** Only the open window authorizes a transaction. Greeting/farewell remain
   * busy field states but cannot buy, sell, or be closed a second time. */
  get currentShop(): { id: number; groupId: number; entityId: string } | null {
    const shop = this.shopTask;
    return !this.stop && shop?.stage === "open"
      ? { id: shop.id, groupId: shop.groupId, entityId: shop.entityId }
      : null;
  }
  closeShop(): boolean {
    const shop = this.shopTask;
    if (!shop || shop.stage !== "open" || this.stop) return false;
    if (shop.close) {
      shop.stage = "farewell";
      this.dialogue = { ...shop.close, task: shop.id };
    } else {
      this.shopTask = null;
      this.pump();
    }
    return true;
  }
  constructor(
    readonly content: FieldContent,
    readonly eventState: EventState = new EventState(),
    readonly bgm: StaticAudioState = new StaticAudioState(),
    readonly environment: StaticAudioState = new StaticAudioState(),
    readonly options: FieldGameOptions = {},
  ) {
    if (content.entry.synchronization !== undefined) {
      checkpointKeys(content.entry.synchronization, "kind");
      if (content.entry.synchronization.kind !== "map-entry")
        throw new Error("Unknown field entry synchronization source");
      this.synchronizedEntry = false;
    }
    this.transportationId = content.entry.transportationId ?? null;
    const offset = content.entry.cameraOffset ?? { x: 0, y: 0 };
    checkpointKeys(offset, "x,y");
    if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))
      throw new Error("Invalid field entry camera offset");
    this.cameraOffset = Object.freeze({ ...offset });
    if (this.transportationId !== null)
      checkpointInteger(this.transportationId, 1, 0x7fffffff);
    this.tileAnimations = new TileAnimationState(content.map);
    this.openTriggers = new OpenTriggerState(this.tileAnimations);
    this.entityList = [...content.map.entities];
    const groups = content.map.groups,
      initial = content.map.initialGroups;
    this.defaultProperties =
      groups && initial
        ? initial.includes("entity_default")
          ? groups.entity_default!.entities
          : []
        : [...this.entityList];
    const latest = initial?.filter((name) => name !== "entity_default").at(-1);
    this.currentProperties =
      groups && latest
        ? [...this.defaultProperties, ...groups[latest]!.entities]
        : this.defaultProperties;
    if (this.entityList.some((e) => e.kind === 18))
      requireMinimapMedia(this.entityList, content.minimap);
    this.collisionRange = fieldCollisionRange(
      content.map.width,
      content.map.height,
      this.entityList,
    );
    for (const name of content.map.initialGroups ?? [])
      this.activeGroups.add(name);
    const p = content.entry.player;
    this.actors["-1001"] = {
      ...p,
      id: "-1001",
      motion: null,
      steps: 0,
      animation: this.initialAnimation(p.asset, p.direction, p.mount),
    };
    if (content.entry.playerVisible !== undefined && typeof content.entry.playerVisible !== "boolean")
      throw new Error("Unknown field entry player visibility");
    if (content.entry.playerVisible === false) this.hiddenEntities.add("-1001");
    Object.assign(this.actors, this.createActors(this.entityList));
    this.partyActors = content.entry.partyActors && options.partyAppearance
      ? new FieldPartyActors(options.partyAppearance.catalog, content.entry.partyActors, this.transportationId) : null;
    if (this.partyActors) {
      const media = this.partyActors.playerMedia();
      if (media.asset !== this.player.asset || media.mount !== (this.player.mount || null))
        throw new Error("Field entry does not match source player appearance");
    }
    const treasures = this.prepareTreasureInitialization(this.entityList);
    this.tileAnimations.register(this.entityList);
    this.initializeTreasures(treasures);
    this.openTriggers.initialize(this.entityList, this.player);
  }
  private initialAnimation(
    asset: string,
    direction: Direction,
    mount: string | null,
  ): ActorAnimation | null {
    const character = this.content.characters[asset];
    // Mounted composition still uses the explicit opening presentation profile.
    // Logic-only fixtures can omit media; explicit animation commands always require it.
    if (mount || !character) return null;
    const animation = new ActorAnimation(character);
    animation.cue(FIELD_POSE[direction], -1);
    return animation;
  }
  private createActors(
    entities: readonly FieldEntity[],
  ): Record<string, Actor> {
    const actors: Record<string, Actor> = {};
    for (const e of entities)
      if ((e.kind === 6 || e.kind === 17) && e.asset)
        actors[e.id] = {
          id: e.id,
          x: e.x,
          y: e.y,
          layer: e.layer,
          direction: e.direction,
          asset: e.asset,
          mount: null,
          motion: null,
          steps: 0,
          animation: this.initialAnimation(e.asset, e.direction, null),
        };
    return actors;
  }
  /** Source SetEventEntityGroup appends entities; it does not replace existing groups. */
  private activateGroup(name: string): void {
    const group = this.content.map.groups?.[name];
    if (!group) throw new Error(`缺少实体组 ${name}`);
    if (this.activeGroups.has(name))
      throw new Error(`重复实体组激活尚未恢复：${name}`);
    if (group.blockers.length)
      throw new Error(`${name}：${group.blockers[0]!.reason}`);
    if (group.entities.some((e) => e.kind === 18))
      requireMinimapMedia(group.entities, this.content.minimap);
    const ids = new Set(this.entityList.map((e) => e.id));
    ids.add("-1001");
    for (const e of group.entities) {
      if (ids.has(e.id)) throw new Error(`实体身份冲突 ${e.id}`);
      ids.add(e.id);
    }
    // Validate the entire group before any actor, collision, or trigger becomes visible.
    const actors = this.createActors(group.entities);
    const treasures = this.prepareTreasureInitialization(group.entities);
    this.tileAnimations.register(group.entities);
    this.entityList.push(...group.entities);
    this.initializeTreasures(treasures);
    Object.assign(this.actors, actors);
    this.activeGroups.add(name);
    this.currentProperties = [...this.defaultProperties, ...group.entities];
  }
  get player(): Actor {
    return this.actors["-1001"]!;
  }
  private prepareTreasureInitialization(entities: readonly FieldEntity[]): FieldEntity[] {
    return entities.filter((e) => e.kind === 7).filter((e) => {
      if (!e.treasure) throw new Error("Missing treasure source binding");
      validateTreasureInventory(e.treasure);
      const value = this.eventState.read(treasureFlagRef(e.treasure.flagId));
      if (value !== 0 && value !== 1) throw new Error("Unknown treasure entry flag");
      return value === 1;
    });
  }
  private linkedTreasureTiles(entity: FieldEntity): FieldEntity | undefined {
    // Source SearchTileAnimRegionEnitity returns only the first registered match.
    return this.entityList.find((e) => e.kind === 1 && e.objectId === entity.treasure!.presentation.linkObjectId);
  }
  private openTreasure(entity: FieldEntity): void {
    this.openedTreasures.add(entity.id);
    if (entity.treasure!.presentation.pickUp) this.hiddenEntities.add(entity.id);
  }
  private initializeTreasures(entities: readonly FieldEntity[]): void {
    for (const entity of entities) {
      this.openTreasure(entity);
      const link = this.linkedTreasureTiles(entity);
      if (link) this.tileAnimations.forceLastFrame(link.id);
    }
  }
  private prepareTreasureTask(request: TreasureBoxRequest, site: Site, selected?: FieldEntity): NonNullable<Task["treasure"]> {
    const port = this.options.treasure, limits = this.content.treasureInventoryLimits;
    if (!port || !limits || limits.item !== port.limits.item || limits.gil !== port.limits.gil)
      throw new Error("Missing or mismatched treasure inventory owner");
    if (!selected && (!request.after || request.actionSoundId !== 0))
      throw new Error("Invalid explicit treasure caller");
    const matches = selected ? this.entityList.filter((e) => e === selected && e.treasure?.entityId === request.entityId) :
      this.entityList.filter((e) => e.treasure?.entityId === request.entityId);
    if (matches.length !== 1) throw new Error("Missing or ambiguous treasure entity");
    const entity = matches[0]!, definition = entity.treasure!;
    if (selected && (request.after || !request.message || request.actionSoundId !== definition.presentation.soundId))
      throw new Error("Invalid ordinary treasure caller");
    // Exhausted stacks use a canonical zero record in our shared owner. Native
    // removes them; amounts above MAX_ITEM would distinguish these histories.
    if (definition.reward.kind !== "grant-gil" && definition.contentNum > limits.item)
      throw new Error("Treasure overflow requires native inventory record presence");
    const state = createTreasureTask(definition, request);
    if (request.message) {
      const messages = entity.treasureMessages;
      if (!messages || (messages.reward && messages.reward.key !== definition.presentation.messageKey) ||
          messages.empty.key !== definition.messages.emptyKey ||
          (messages.countOver && messages.countOver.key !== definition.messages.countOverKey))
        throw new Error("Missing or mismatched treasure message binding");
      for (const message of [messages.reward, messages.empty, messages.countOver])
        if (message && (typeof message.text !== "string" || typeof message.speaker !== "string" ||
            (message.alignment !== undefined && message.alignment !== "center")))
          throw new Error("Invalid treasure message presentation");
    }
    const link = this.linkedTreasureTiles(entity);
    if (link && !this.tileAnimations.has(link.id)) throw new Error("Missing treasure tile binding");
    new EventState(this.eventState.snapshot()).write(treasureFlagRef(definition.flagId), 1);
    return { state, entity, site, closeMessage: true, messageAvailableAt: 0 };
  }
  private advanceTreasure(t: Task, acknowledgement?: TreasureTaskInput): void {
    const pending = t.treasure!, port = this.options.treasure!;
    let input = acknowledgement;
    if (!input) {
      if (pending.state.wait === "message") return;
      if (pending.state.wait === "complete") {
        t.treasure = null;
        if (t.treasureRoot) t.done = true;
        return;
      }
      if (pending.state.wait === "frame") input = { kind: "frame" };
      else {
        const value = this.eventState.read(treasureFlagRef(pending.state.definition.flagId));
        if (value !== 0 && value !== 1) throw new Error("Unknown treasure opened flag");
        input = { kind: pending.state.wait === "start" ? "start" : "sound-complete",
          flag: value === 1, owned: port.read(), limits: port.limits };
      }
    }
    const next = advanceTreasureTask(pending.state, input);
    const draft = new EventState(this.eventState.snapshot());
    const link = this.linkedTreasureTiles(pending.entity);
    if (link && !this.tileAnimations.has(link.id)) throw new Error("Missing treasure tile binding");
    const resolveMessage = (key: string): FieldMessage => {
      const messages = pending.entity.treasureMessages;
      const found = messages && [messages.reward, messages.empty, messages.countOver].find((m) => m?.key === key);
      if (!found) throw new Error("Missing treasure message " + key);
      return found;
    };
    // Validate the entire selected branch before its first grant/open, including
    // messages beyond the next suspension. Unused script-chest reward templates
    // may be absent; they never authorize a message-producing explicit caller.
    for (const effect of [...next.effects, ...next.state.remaining]) {
      if (effect.kind === "message") resolveMessage(effect.key);
      else if (effect.kind === "set-message-value") {
        const value = pending.entity.treasureMessages?.parameter;
        if (!value || value.token !== effect.token || (effect.token === "NUM" ?
            value.value !== String(effect.number) : value.sourceKey !== effect.messageKey))
          throw new Error("Missing or mismatched treasure message parameter");
      } else if (effect.kind === "flag") draft.write(effect.ref, effect.value);
      else if (effect.kind === "run-script") {
        if (!this.content.scripts[effect.name]) throw new Error("Missing treasure event script");
        draft.beginScript(this.content.scriptLocals?.[effect.name] ?? null);
      }
    }
    let transaction: FieldInventoryTransaction | null = null;
    for (const effect of next.effects) {
      if (effect.kind === "grant") {
        if (transaction) throw new Error("Multiple treasure reward transactions");
        transaction = port.prepare(effect.command);
        if (transaction.result !== null) throw new Error("Unexpected treasure reward result");
      }
    }
    // Commit the owner before publishing task progress, presentation or flags.
    // No asynchronous dependency is evaluated inside this publication boundary.
    transaction?.commit();
    for (const effect of next.effects) {
      switch (effect.kind) {
        // This build's FieldController.DeactivateAction (0x2c8ef0) is a shared
        // return stub. Task ownership, not this call, prevents repeated input.
        case "deactivate-action": break;
        case "sound":
          this.presentationOmissions.push({ site: pending.site, kind: "sound", soundId: effect.id });
          break;
        case "open": this.openTreasure(pending.entity); break;
        case "tile-animation": if (link) this.tileAnimations.playDefault(link.id); break;
        case "run-script":
          this.eventState.beginScript(this.content.scriptLocals?.[effect.name] ?? null);
          this.tasks.push(this.task(effect.name, 0, "-1001"));
          break;
        // The compiler resolves the source parameter into the bound message;
        // there is no mutable global substitution register in the Web renderer.
        case "grant": case "set-message-value": break;
        case "scene-state": this.treasureSceneState = effect.state; break;
        case "message":
          this.dialogue = { ...resolveMessage(effect.key), task: t.id };
          this.retainedMessage = null;
          pending.closeMessage = effect.close;
          pending.messageAvailableAt = this.time + 10;
          break;
        case "flag": this.eventState.write(effect.ref, effect.value); break;
        case "yield": t.wait = 10; break;
      }
    }
    pending.state = next.state;
  }
  private treasureHandoffBlocked(): boolean {
    return this.tasks.some((task) => {
      if (task.done || !task.treasure) return false;
      const state = task.treasure.state;
      // The ordinary script wrapper explicitly does not own/wait for the
      // registered event. Its final frame has no reward, message or flag left.
      return !(task.treasureRoot && state.definition.scriptId > 0 &&
        state.wait === "frame" && state.remaining.length === 0 &&
        !state.request.after && !this.dialogue && this.treasureSceneState === "player");
    });
  }
  get partyActorCheckpoint(): FieldPartyActorCheckpoint | null {
    return this.partyActors?.checkpoint() ?? null;
  }
  private requirePlayerMedia(asset: string, mount: string | null): void {
    for (const [id, riding] of [[asset, !!mount], ...(mount ? [[mount, false]] : [])] as [string, boolean][]) {
      const missing = missingFieldPoses(this.content.characters[id], riding);
      if (missing.length) throw new Error(`Missing party appearance media ${id}/${missing.join(",")}`);
    }
  }
  private preparePartyAppearance(appearance: PartyAppearanceCandidate | undefined, setDummy = true): () => void {
    if (!this.partyActors || !appearance) throw new Error("Party actor refresh is unavailable");
    return this.partyActors.prepare(appearance, (media, plan) => this.preparePartyRenderer(media, plan), setDummy);
  }
  private preparePartyRenderer({ asset, mount }: { asset: string; mount: string | null }, plan: PartyActorPlan): () => void {
    const actor = this.player;
    if (plan.cameraOffset && (plan.cameraOffset.x !== this.cameraOffset.x || plan.cameraOffset.y !== this.cameraOffset.y))
      throw new Error("Changing the field camera offset during party refresh is not implemented");
    if (actor.motion) throw new Error("Party appearance refresh during player movement is not supported");
    this.requirePlayerMedia(asset, mount);
    const animation = this.initialAnimation(asset, actor.direction, mount);
    return () => { Object.assign(actor, { asset, mount, animation }); };
  }
  get busy(): boolean {
    return (
      this.tasks.some((t) => !t.done) ||
      !!this.dialogue ||
      !!this.shopTask ||
      this.treasureSceneState === "message" ||
      !!this.stop ||
      this.openTriggers.busy ||
      (this.interaction?.waitUntil ?? 0) > this.time
    );
  }
  get checkpointReady(): boolean {
    return (
      this.synchronizedEntry !== false &&
      !this.busy &&
      !this.fade &&
      !this.interaction &&
      Object.values(this.actors).every((a) => a.motion === null)
    );
  }
  checkpoint(): FieldCheckpoint {
    if (!this.checkpointReady)
      throw new Error("Cannot save during field movement or an event");
    return {
      kind: "idle-field-v5",
      contentHash: this.content.contentHash,
      time: this.time,
      remainder: this.remainder,
      nextTask: this.nextTask,
      transportationId: this.transportationId,
      entrySynchronized: this.synchronizedEntry,
      partyActors: this.partyActorCheckpoint,
      eventState: this.eventState.snapshot(),
      activeGroups: [...this.activeGroups],
      hiddenEntities: [...this.hiddenEntities],
      openedTreasures: [...this.openedTreasures],
      actors: Object.values(this.actors).map(
        ({ motion: _, animation, ...actor }) => ({
          ...actor,
          animation: animation?.snapshot() ?? null,
        }),
      ),
      tiles: this.tileAnimations.checkpoint(),
      doors: this.openTriggers.checkpoint(),
      bgm: this.bgm.snapshot(),
      environment: this.environment.snapshot(),
    };
  }
  /** Rebuild dependencies from trusted content without replaying initialization or triggers. */
  static restore(
    content: FieldContent,
    raw: FieldCheckpoint,
    options: FieldGameOptions = {},
  ): FieldGame {
    const s = structuredClone(raw);
    checkpointKeys(
      s,
      "kind,contentHash,time,remainder,nextTask,transportationId,entrySynchronized,partyActors,eventState,activeGroups,hiddenEntities,openedTreasures,actors,tiles,doors,bgm,environment",
    );
    if (s.kind !== "idle-field-v5" || s.contentHash !== content.contentHash ||
      s.transportationId !== (content.entry.transportationId ?? null))
      throw new Error("Field checkpoint source/version mismatch");
    // Pending entry scripts cannot be saved. Unknown bootstrap context cannot
    // acquire a source synchronization proof merely by editing a checkpoint.
    if (s.entrySynchronized !== (content.entry.synchronization ? true : null))
      throw new Error("Field checkpoint entry synchronization mismatch");
    checkpointNumber(s.time);
    checkpointNumber(s.remainder, 0, 10);
    checkpointInteger(s.nextTask, 1);
    if (s.remainder >= 10) throw new Error("Invalid field remainder");
    const next = new FieldGame(
      content,
      new EventState(s.eventState),
      StaticAudioState.restore(s.bgm, content.bgm),
      StaticAudioState.restore(s.environment, content.environment),
      options,
    );
    checkpointIds(s.activeGroups);
    const initial = [...next.activeGroups];
    if (initial.some((id, n) => s.activeGroups[n] !== id))
      throw new Error("Initial field groups changed in checkpoint");
    for (const id of s.activeGroups.slice(initial.length))
      next.activateGroup(id);
    if (next.partyActors) {
      if (!s.partyActors) throw new Error("Missing saved party appearances");
      next.partyActors.restore(s.partyActors);
      const media = next.partyActors.playerMedia();
      next.requirePlayerMedia(media.asset, media.mount);
      Object.assign(next.player, media);
    } else if (s.partyActors !== null) throw new Error("Unbound saved party appearances");
    checkpointIds(s.hiddenEntities);
    if (s.hiddenEntities.some((id) => !next.hasEntity(id)))
      throw new Error("Unknown hidden saved entity");
    checkpointIds(s.openedTreasures);
    if (s.openedTreasures.some((id) => !next.entities.some((e) => e.id === id && e.treasure)))
      throw new Error("Unknown opened treasure identity");
    for (const id of s.openedTreasures) {
      const entity = next.entities.find((e) => e.id === id)!;
      if (entity.treasure!.presentation.pickUp && !s.hiddenEntities.includes(id))
        throw new Error("Opened pickup treasure is still visible");
    }
    if (!Array.isArray(s.actors)) throw new Error("Missing saved actors");
    checkpointSameIds(
      s.actors.map((a) => a.id),
      Object.keys(next.actors),
    );
    for (const a of s.actors) {
      checkpointKeys(a, "id,x,y,layer,direction,asset,mount,steps,animation");
      const actor = next.actors[a.id]!;
      checkpointInteger(a.steps);
      checkpointInteger(a.x, -0x80000000, 0x7fffffff);
      checkpointInteger(a.y, -0x80000000, 0x7fffffff);
      checkpointInteger(a.layer, -0x80000000, 0x7fffffff);
      if (
        typeof a.direction !== "string" ||
        !Object.hasOwn(DELTA, a.direction) ||
        a.asset !== actor.asset ||
        (a.mount !== actor.mount && a.mount !== content.entry.player.mount) ||
        (a.id === "-1001"
          ? !content.map.collisions[a.layer]
          : a.layer !== actor.layer)
      )
        throw new Error("Invalid saved actor identity, layer or pose");
      const animation = next.initialAnimation(a.asset, a.direction, a.mount);
      if (!!animation !== (a.animation !== null))
        throw new Error("Saved actor animation dependency changed");
      if (animation) animation.restore(a.animation);
      Object.assign(actor, a, { animation, motion: null });
    }
    next.hiddenEntities.clear();
    s.hiddenEntities.forEach((id) => next.hiddenEntities.add(id));
    next.openedTreasures.clear();
    s.openedTreasures.forEach((id) => next.openedTreasures.add(id));
    next.tileAnimations.restoreCheckpoint(s.tiles);
    next.openTriggers.restoreCheckpoint(s.doors, next.entities);
    next.time = s.time;
    next.remainder = s.remainder;
    next.nextTask = s.nextTask;
    next.synchronizedEntry = s.entrySynchronized;
    return next;
  }
  private block(message: string, site: Site | null = null) {
    this.stop = { kind: "unsupported", message, site };
  }
  private dynamicCollision(p: Point, layer: number): number | null {
    let mask = 15;
    for (const e of this.entityList)
      if (
        !this.hiddenEntities.has(e.id) &&
        e.kind === 19 &&
        e.layer === layer &&
        contains(e, p)
      ) {
        if (
          e.collision === null ||
          !Number.isInteger(e.collision) ||
          e.collision < 0 ||
          e.collision > 7
        ) {
          this.block("尚未支持的动态碰撞", {
            script: "collision",
            index: 0,
            source: e.source,
          });
          return null;
        }
        mask &= collisionMask(e.collision);
      }
    return mask;
  }
  private collision(p: Point, layer: number): number | null {
    if (!inCollisionRange(p, this.collisionRange)) return 0;
    const cell =
      this.content.map.collisions[layer]?.[p.y * this.content.map.width + p.x];
    try {
      const mask = collisionMask(cell as number),
        dynamic = this.dynamicCollision(p, layer);
      return dynamic === null ? null : mask & dynamic;
    } catch (error) {
      this.block(error instanceof Error ? error.message : String(error));
      return null;
    }
  }
  private occupied(points: Point[], layer: number): boolean {
    return (
      this.entityList.some(
        (e) =>
          ((e.kind === 8 && this.openTriggers.blocks(e.id)) ||
            ((e.kind === 5 || e.kind === 7) && e.mapObject?.collision)) &&
          e.layer === layer &&
          !this.hiddenEntities.has(e.id) &&
          points.some((p) => contains(e, p)),
      ) ||
      Object.values(this.actors).some(
        (a) =>
          a.id !== this.player.id &&
          !this.hiddenEntities.has(a.id) &&
          this.entityList.find((e) => e.id === a.id)?.npc?.collision !==
            false &&
          a.layer === layer &&
          points.some((p) => a.x === p.x && a.y === p.y),
      )
    );
  }
  private slopeDestination(
    direction: Direction,
    straight: Point,
  ): Point | null {
    const p = this.player,
      map = this.content.map,
      grid = map.collisions[p.layer];
    if (!grid || !inCollisionRange(straight, this.collisionRange)) return null;
    const delta = redirectAtSlope(
      grid[straight.y * map.width + straight.x]!,
      direction,
    );
    if (!delta) return null;
    const to = { x: p.x + delta.x, y: p.y + delta.y };
    if (!inCollisionRange(to, this.collisionRange)) return null;
    let mapping = this.collisionMappings.get(p.layer);
    if (!mapping) {
      mapping = buildCollisionMapping(
        grid,
        map.width,
        map.height,
        this.collisionRange,
      );
      this.collisionMappings.set(p.layer, mapping);
    }
    if (
      !(mapping[p.y * map.width + p.x]! & diagonalBit(delta.x, delta.y)) ||
      !(mapping[to.y * map.width + to.x]! & diagonalBit(-delta.x, -delta.y))
    )
      return null;
    const horizontal = { x: to.x, y: p.y },
      vertical = { x: p.x, y: to.y };
    // The native path graph is static. Dynamic colliders and actors must still block its swept corners.
    const cells = [p, horizontal, vertical, to];
    for (const cell of cells) {
      const mask = this.dynamicCollision(cell, p.layer);
      if (mask === null) return null;
      const xBit = cell.x === p.x ? (delta.x > 0 ? 4 : 2) : delta.x > 0 ? 2 : 4;
      const yBit = cell.y === p.y ? (delta.y > 0 ? 8 : 1) : delta.y > 0 ? 1 : 8;
      if (!(mask & xBit) || !(mask & yBit)) return null;
    }
    return this.occupied([horizontal, vertical, to], p.layer) ? null : to;
  }
  move(direction: Direction): boolean {
    const p = this.player;
    if (this.busy || p.motion || this.movementBlocker) return false;
    p.direction = direction;
    const faceBlockedStep = (): false => {
      try {
        p.animation?.look(direction);
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error));
      }
      return false;
    };
    const d = DELTA[direction];
    let to = { x: p.x + d.x, y: p.y + d.y };
    const doors = this.entityList.filter(
      (e) =>
        e.kind === 8 &&
        e.layer === p.layer &&
        !this.hiddenEntities.has(e.id) &&
        this.openTriggers.blocks(e.id) &&
        contains(e, to),
    );
    if (doors.length) {
      const e = doors[0]!,
        site: Site = { script: "open-trigger", index: 0, source: e.source };
      if (doors.length > 1)
        this.block("同格开门触发器的接触顺序尚未恢复", site);
      else
        try {
          if (
            this.openTriggers.start(e, this.entityList, direction) &&
            e.openTrigger!.soundId > 0
          )
            this.presentationOmissions.push({
              site,
              kind: "sound",
              soundId: e.openTrigger!.soundId,
            });
        } catch (error) {
          this.block(
            error instanceof Error ? error.message : String(error),
            site,
          );
        }
      return faceBlockedStep();
    }
    const fromMask = this.collision(p, p.layer),
      toMask = this.collision(to, p.layer);
    if (fromMask === null || toMask === null || !(fromMask & BIT[direction]))
      return faceBlockedStep();
    if (!(toMask & BIT[OPPOSITE[direction]])) {
      try {
        const redirected = this.slopeDestination(direction, to);
        if (!redirected) return faceBlockedStep();
        to = redirected;
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error));
        return false;
      }
    }
    if (this.occupied([to], p.layer)) return faceBlockedStep();
    let step: ReturnType<FieldConditionPort["prepareStep"]> | null;
    try {
      step = this.preparePlayerStep();
      p.animation?.move(direction, 0.24);
    } catch (error) {
      this.block(error instanceof Error ? error.message : String(error));
      return false;
    }
    this.pendingPlayerStep = step;
    p.motion = {
      from: { x: p.x, y: p.y },
      to,
      elapsed: 0,
      duration: 240,
      manual: true,
    };
    return true;
  }
  get movementBlocker(): string | null {
    return this.options.movementBlocker?.(this.transportationId, true) ?? null;
  }
  private preparePlayerStep() {
    // Native SetupCharacterData captures the moving corps at move start.
    // The owner rejects changes to that snapshot before completion; it must
    // never silently recalculate against a different party at the destination.
    return this.transportationId !== null && this.options.fieldSteps
      ? this.options.fieldSteps.prepareStep(this.transportationId)
      : null;
  }
  confirm(): void {
    if (this.stop) return;
    if (this.dialogue) {
      if (this.shopTask) {
        if (
          this.dialogue.task !== this.shopTask.id ||
          this.shopTask.stage === "open"
        ) {
          this.block("商店对话状态不一致");
          return;
        }
        if (this.shopTask.stage === "greeting") this.shopTask.stage = "open";
        else this.shopTask = null;
        this.dialogue = null;
        this.retainedMessage = null;
        this.pump();
        return;
      }
      const task = this.tasks.find((t) => t.id === this.dialogue!.task);
      if (task?.treasure) {
        if (this.time < task.treasure.messageAvailableAt) return;
        const message = this.dialogue, close = task.treasure.closeMessage;
        try { this.advanceTreasure(task, { kind: "message-complete" }); }
        catch (error) {
          this.block(error instanceof Error ? error.message : String(error), task.treasure.site);
          return;
        }
        this.retainedMessage = close ? null : message;
      } else this.retainedMessage = null;
      this.dialogue = null;
      this.pump();
      return;
    }
    if (this.busy || this.player.motion) return;
    const p = this.player,
      d = DELTA[p.direction],
      target = { x: p.x + d.x, y: p.y + d.y };
    const hits = this.entityList.filter((e) => {
      const properties = e.npc ?? e.mapObject;
      return (
        (e.kind === 6 || e.kind === 17 || e.kind === 5 || e.kind === 7) &&
        !(
          e.kind === 7 &&
          e.mapObject?.collision === false &&
          this.openedTreasures.has(e.id)
        ) &&
        !this.hiddenEntities.has(e.id) &&
        (this.actors[e.id]?.layer ?? e.layer) === p.layer &&
        (properties ? properties.interaction.kind !== "none" : !!e.script) &&
        (e.kind === 6 || e.kind === 17
          ? this.actors[e.id]?.x === target.x &&
            this.actors[e.id]?.y === target.y
          : contains(e, target)) &&
        (!properties ||
          (!!(
            properties.acceptDirection & ACTION_SIDE[OPPOSITE[p.direction]]
          ) &&
            (properties.interaction.kind === "blocked" ||
              properties.talkMounts.includes(p.mount ?? ""))))
      );
    });
    if (hits.length > 1) {
      this.block("同格交互目标不明确");
      return;
    }
    const e = hits[0];
    if (!e) return;
    const site = {
        script: e.script ?? "field-interaction",
        index: 0,
        source: e.source,
      },
      npc = e.npc,
      properties = npc ?? e.mapObject,
      actor = this.actors[e.id];
    if (!properties || ((e.kind === 6 || e.kind === 17) && (!npc || !actor))) {
      this.block("此交互尚未迁移", site);
      return;
    }
    const action = properties.interaction;
    if (action.kind === "blocked") {
      this.block(action.reason, site);
      return;
    }
    if (npc && (npc.moveType !== 0 || actor?.motion)) {
      this.block("此 NPC 的移动控制器尚未迁移", site);
      return;
    }
    if (
      action.kind === "script" &&
      action.script !== null &&
      !this.content.scripts[action.script]
    ) {
      this.block("缺少交互事件脚本 " + action.script, site);
      return;
    }
    if (action.kind === "none") return;
    if (action.kind === "shop") {
      try {
        if (
          !Number.isInteger(action.groupId) ||
          action.groupId <= 0 ||
          !this.options.shop
        )
          throw new Error("Missing ordinary shop state provider");
        for (const message of [action.start, action.close])
          if (
            message !== null &&
            (!message ||
              typeof message.key !== "string" ||
              !message.key ||
              typeof message.text !== "string" ||
              typeof message.speaker !== "string" ||
              (message.alignment !== undefined &&
                message.alignment !== "center"))
          )
            throw new Error("Invalid ordinary shop message");
        this.options.shop.validate(action.groupId);
      } catch (error) {
        this.block(
          error instanceof Error ? error.message : String(error),
          site,
        );
        return;
      }
    }
    let treasureTask: Task["treasure"] = null;
    if (action.kind === "treasure") {
      try { treasureTask = this.prepareTreasureTask(action.request, site, e); }
      catch (error) {
        this.block(error instanceof Error ? error.message : String(error), site);
        return;
      }
    }
    this.interaction = {
      entityId: e.id,
      restoreDirection:
        npc?.eyeContact && npc.turnAround && actor ? actor.direction : null,
      // Empty source actions yield before returning control. One logical tick is the Web adaptation.
      waitUntil:
        this.time +
        (action.kind === "script" && action.script === null ? 10 : 0),
    };
    if (npc?.eyeContact && actor) {
      actor.direction = OPPOSITE[p.direction];
      try {
        actor.animation?.look(actor.direction);
      } catch (error) {
        this.block(
          error instanceof Error ? error.message : String(error),
          site,
        );
        return;
      }
    }
    if (properties.soundId > 0 && action.kind !== "treasure")
      this.presentationOmissions.push({
        site,
        kind: "sound",
        soundId: properties.soundId,
      });
    if (action.kind === "script") {
      if (action.script !== null) this.beginRoot(action.script);
    } else if (action.kind === "treasure") {
      const task = this.task(site.script, 0, "-1001");
      task.treasureRoot = true;
      task.treasure = treasureTask;
      this.tasks = [task];
      this.pump();
    } else if (action.kind === "shop") {
      const id = this.nextTask++;
      this.shopTask = {
        id,
        groupId: action.groupId,
        entityId: e.id,
        stage: action.start ? "greeting" : "open",
        close: action.close ? { ...action.close } : null,
      };
      if (action.start) this.dialogue = { ...action.start, task: id };
    } else this.dialogue = { ...action.message, task: 0 };
  }
  private finishInteraction(): void {
    if (!this.interaction || this.busy) return;
    const { entityId, restoreDirection } = this.interaction;
    if (restoreDirection && this.actors[entityId]) {
      this.actors[entityId]!.direction = restoreDirection;
      try {
        this.actors[entityId]!.animation?.look(restoreDirection);
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error));
      }
    }
    this.interaction = null;
  }
  /** Integer 10 ms simulation steps make render-frame partitioning irrelevant. */
  advance(milliseconds: number): void {
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < 0 ||
      milliseconds > 60000
    )
      throw new Error("Invalid elapsed time");
    this.remainder += milliseconds;
    while (this.remainder >= 10) {
      this.remainder -= 10;
      if (this.stop) continue;
      this.bgm.advance(10, this.content.bgm);
      this.environment.advance(10, this.content.environment);
      this.tileAnimations.advance(10);
      this.openTriggers.advance();
      this.time += 10;
      if (this.fade) {
        this.fade.elapsed += 10;
        if (this.fade.elapsed >= this.fade.duration) this.fade = null;
      }
      let entered = false;
      for (const a of Object.values(this.actors)) {
        try {
          a.animation?.advance(10);
        } catch (error) {
          this.block(error instanceof Error ? error.message : String(error));
          return;
        }
        const m = a.motion;
        if (!m) continue;
        m.elapsed += 10;
        try {
          a.animation?.linkToMovement(Math.min(1, m.elapsed / m.duration));
        } catch (error) {
          this.block(error instanceof Error ? error.message : String(error));
          return;
        }
        if (m.elapsed >= m.duration) {
          // Resolve all owned effects before publishing coordinates or starting
          // destination events. A failed/stale provider leaves this move pending.
          if (a.id === this.player.id && this.pendingPlayerStep) {
            try {
              const step = this.pendingPlayerStep;
              step.commit();
              this.pendingPlayerStep = null;
              if (step.result.soundId !== null)
                this.presentationOmissions.push({
                  site: { script: "field-condition-step", index: a.steps, source: this.content.map.source },
                  kind: "sound",
                  soundId: step.result.soundId,
                });
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error));
              return;
            }
          }
          a.animation?.stop();
          a.x = m.to.x;
          a.y = m.to.y;
          a.motion = null;
          a.steps++;
          if (m.manual) entered = true;
        }
      }
      for (const t of this.tasks) t.wait = Math.max(0, t.wait - 10);
      if (entered) this.enter();
      this.pump();
    }
  }
  private enter(): void {
    const p = this.player,
      hits = this.entityList.filter(
        (e) =>
          !this.hiddenEntities.has(e.id) &&
          e.layer === p.layer &&
          contains(e, p),
      );
    const transitions = hits.filter((e) => e.kind === 4);
    if (transitions.length > 1) {
      this.block("层切换目标不明确");
      return;
    }
    if (transitions[0]) {
      const next = transitions[0].destinationLayer;
      if (next === null || !this.content.map.collisions[next]) {
        this.block("未支持的地图层");
        return;
      }
      p.layer = next;
    }
    const events = hits.filter((e) => e.kind === 2 || e.kind === 3);
    if (events.length > 1) {
      this.block("同格触发器顺序尚未验证");
      return;
    }
    const e = events[0];
    if (!e) return;
    if (e.kind === 3) {
      const site = {
        script: e.script ?? "map-transition",
        index: 0,
        source: e.source,
      };
      if (!e.destination) {
        this.block("缺少跨地图目标", site);
        return;
      }
      this.stop = {
        kind: "map-transition",
        message: "正在载入地图…",
        site,
        request: {
          ...e.destination,
          continuation: null,
          birdview: false,
          skipFade: false,
          skipBgm: false,
          origin: "trigger",
        },
      };
      return;
    }
    if (!e.script || !this.content.scripts[e.script]) {
      this.block("缺少事件脚本");
      return;
    }
    this.beginRoot(e.script);
  }
  /** Runs a package-provided event through the same VM as map triggers. */
  startEvent(script: string): boolean {
    if (this.busy || this.player.motion) return false;
    if (!this.content.scripts[script])
      throw new Error("Missing event script: " + script);
    this.beginRoot(script);
    return true;
  }
  /** Called exactly once by the source map-entry host. A normal event cannot
   * stand in for LastSettings -> SetupEncountData. No-script entries still
   * execute the source post-setup boundary. */
  startMapEntry(script: string | null): void {
    if (this.content.entry.synchronization?.kind !== "map-entry" ||
        this.synchronizedEntry !== false || this.entryTaskStarted)
      throw new Error("No pending source map entry");
    if (this.busy || this.player.motion || this.fade)
      throw new Error("Cannot begin map entry during field activity");
    if (script !== null && !this.content.scripts[script])
      throw new Error("Missing map entry script: " + script);
    this.entryTaskStarted = true;
    if (script !== null) this.beginRoot(script);
    else this.finishMapEntry();
  }
  get entrySynchronized(): boolean | null { return this.synchronizedEntry; }
  get battleEntryContext(): ReturnType<typeof projectFieldEntryContext> {
    return projectFieldEntryContext(this.content.map.entryContext, {
      mapId: this.content.map.identity?.mapId ?? null,
      transportationId: this.transportationId,
      activeGroups: [...this.activeGroups],
      player: this.player,
      entrySynchronized: this.synchronizedEntry,
    });
  }
  private finishMapEntry(): void {
    if (this.synchronizedEntry === false && this.entryTaskStarted &&
        !this.busy && !this.fade && !this.interaction &&
        Object.values(this.actors).every((actor) => actor.motion === null))
      this.synchronizedEntry = true;
  }
  /** Explicit diagnostic entry, never counted as a story transition or a new-game state. */
  previewMap(mapId: number, entrance: number): void {
    if (this.busy || this.player.motion)
      throw new Error("Cannot preview a map during an event");
    this.stop = {
      kind: "map-transition",
      message: "正在载入地图预览…",
      site: null,
      request: {
        mapId,
        entrance,
        continuation: null,
        birdview: false,
        skipFade: true,
        skipBgm: true,
        origin: "development",
      },
    };
  }
  private beginRoot(script: string): void {
    this.eventState.beginScript(this.content.scriptLocals?.[script] ?? null);
    this.tasks = [this.task(script, 0, "-1001")];
    this.pump();
  }
  private task(script: string, pc: number, actor: string): Task {
    return {
      id: this.nextTask++,
      script,
      pc,
      actor,
      stack: [],
      wait: 0,
      children: [],
      pending: [],
      remaining: 0,
      move: null,
      animationWait: false,
      treasure: null,
      treasureRoot: false,
      done: false,
    };
  }
  private hasEntity(id: string): boolean {
    return (
      !!this.actors[id] ||
      this.entityList.some((e) => e.id === id) ||
      !!this.content.entry.absentHideTargets?.includes(id)
    );
  }
  /** Validate the handoff before consuming rewards. The commit only schedules
   * the continuation; normal simulation, not reward publication, runs its code. */
  prepareEncounterReturn(party: number): () => void {
    if (
      this.stop?.kind !== "encounter" ||
      this.stop.party !== party ||
      !this.stop.continuation
    )
      throw new Error("No matching field encounter to resume");
    const continuation = this.stop.continuation;
    if (!this.content.scripts[continuation])
      throw new Error("Missing battle continuation");
    const stop = this.stop;
    const locals = structuredClone(
      this.content.scriptLocals?.[continuation] ?? null,
    );
    new EventState(this.eventState.snapshot()).beginScript(locals);
    return () => {
      if (this.stop !== stop) throw new Error("Stale battle continuation");
      this.eventState.beginScript(locals);
      this.tasks = [this.task(continuation, 0, "-1001")];
      this.stop = null;
      this.remainder = 0;
    };
  }
  /** Isolated field hosts can resume immediately; GameSession uses the prepared
   * continuation so shared-state publication precedes subsequent event code. */
  finishEncounter(party: number): void {
    this.prepareEncounterReturn(party)();
    this.pump();
  }
  private pump(): void {
    if (this.stop || this.dialogue || this.shopTask) return;
    for (let budget = 0; budget < 512; budget++) {
      let changed = false;
      for (const t of [...this.tasks]) {
        if (t.done || t.wait > 0) continue;
        const actor = this.actors[t.actor];
        if (!actor && !this.hasEntity(t.actor)) {
          this.block(`缺少角色 ${t.actor}`);
          return;
        }
        if (actor?.motion) continue;
        if (t.animationWait) {
          if (
            actor
              ? actor.animation?.playing
              : this.tileAnimations.isPlaying(t.actor)
          )
            continue;
          t.animationWait = false;
        }
        if (t.children.some((id) => !this.tasks.find((c) => c.id === id)?.done))
          continue;
        t.children = [];
        if (t.treasure) {
          const site = t.treasure.site;
          try { this.advanceTreasure(t); }
          catch (error) {
            this.block(error instanceof Error ? error.message : String(error), site);
            return;
          }
          if (this.dialogue) return;
          changed = true;
          continue;
        }
        if (t.move && t.remaining > 0) {
          if (!actor) {
            this.block("非角色实体不能移动");
            return;
          }
          const moveBlocker = actor.id === this.player.id
            ? this.options.movementBlocker?.(this.transportationId, false) ?? null
            : null;
          if (moveBlocker) {
            this.block(moveBlocker, t.move);
            return;
          }
          const d = DELTA[t.move.direction];
          let step: ReturnType<FieldConditionPort["prepareStep"]> | null = null;
          try {
            if (actor.id === this.player.id) step = this.preparePlayerStep();
            actor.animation?.move(t.move.direction, t.move.secondsPerCell);
          } catch (error) {
            this.block(
              error instanceof Error ? error.message : String(error),
              t.move,
            );
            return;
          }
          if (actor.id === this.player.id) this.pendingPlayerStep = step;
          actor.direction = t.move.direction;
          actor.motion = {
            from: { x: actor.x, y: actor.y },
            to: { x: actor.x + d.x, y: actor.y + d.y },
            duration: Math.round(t.move.secondsPerCell * 1000),
            elapsed: 0,
            manual: false,
          };
          t.remaining--;
          changed = true;
          continue;
        }
        t.move = null;
        const op = this.content.scripts[t.script]?.[t.pc];
        if (!op) {
          this.block(`无效脚本位置 ${t.script}:${t.pc}`);
          return;
        }
        t.pc++;
        changed = true;
        try {
          if (
            executeEventControl(
              op,
              this.eventState,
              t,
              this.content.scripts[t.script]!.length,
            )
          )
            continue;
        } catch (error) {
          this.block(
            error instanceof Error ? error.message : String(error),
            op,
          );
          return;
        }
        switch (op.kind) {
          case "treasure-box":
            try {
              t.treasure = this.prepareTreasureTask(op, op);
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "roster":
            try {
              // AffectLeaderWithCondition returns immediately only when this
              // source Format explicitly disables KeepBadStatusVisual. Its
              // other branch needs an additional native entity handoff.
              if (op.command.kind === "join" && op.command.recovery &&
                  this.content.scriptSystemFlags?.[t.script]?.keepBadStatusVisual !== false)
                throw new Error("Roster recovery condition-visual context is unavailable");
              executeRosterLifecycleEvent(op, this.options.roster,
                (_members, appearance, setDummy) => this.preparePartyAppearance(appearance, setDummy));
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "party":
            try {
              executePartyEvent(op, this.options.party,
                (_members, appearance, setDummy) => this.preparePartyAppearance(appearance, setDummy));
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "inventory":
            try {
              executeInventoryEvent(
                op,
                this.eventState,
                this.options.inventory,
              );
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "owned-condition":
            try {
              executeOwnedConditionEvent(op, this.options.ownedConditions, (steps) => {
                if (!steps.length) return () => {};
                const visual = this.content.scriptSystemFlags?.[t.script];
                if (visual?.keepBadStatusVisual !== false)
                  throw new Error("Unknown or unsupported owned condition-visual context");
                if (!this.partyActors) throw new Error("Party actor refresh is unavailable");
                return this.partyActors.prepareSequence(steps,
                  (media, plan) => this.preparePartyRenderer(media, plan));
              });
            } catch (error) {
              this.block(error instanceof Error ? error.message : String(error), op);
              return;
            }
            break;
          case "animation-cue":
          case "animation-play":
            try {
              if (actor) {
                if (actor.mount)
                  throw new Error(
                    "Mounted actor animation dispatch is not implemented",
                  );
                if (!actor.animation)
                  throw new Error(
                    "Missing actor animation media " + actor.asset,
                  );
                const animation = actor.animation.clone();
                if (op.kind === "animation-cue")
                  animation.cue(op.animation, op.frame);
                else animation.play(op.animation, op.loop, op.speed);
                actor.animation = animation;
                t.animationWait = op.kind === "animation-play" && !op.loop;
              } else if (op.kind === "animation-cue")
                this.tileAnimations.cue(t.actor, op.frame);
              else {
                this.tileAnimations.play(t.actor, op.loop, op.speed);
                t.animationWait = !op.loop;
              }
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "bgm-play":
          case "bgm-stop":
          case "environment-play":
          case "environment-stop":
            try {
              const bus = op.kind.startsWith("environment-")
                ? this.environment
                : this.bgm;
              const media = op.kind.startsWith("environment-")
                ? this.content.environment
                : this.content.bgm;
              if (op.kind === "bgm-play" || op.kind === "environment-play")
                bus.play(op.track, op.channel, op.fade, op.seek, media);
              else bus.stop(op.channel, op.fade);
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "change-map":
            if (this.treasureHandoffBlocked()) {
              this.block("宝箱任务尚未完成，尚不支持并发切图", op);
              return;
            }
            this.stop = {
              kind: "map-transition",
              message: "正在载入地图…",
              site: op,
              request: op.request,
            };
            return;
          case "entities":
            try {
              this.activateGroup(op.group);
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "nop":
            break;
          case "exit":
            t.done = true;
            break;
          case "return": {
            const pc = t.stack.pop();
            if (pc === undefined) {
              this.block("空调用栈", op);
              return;
            }
            t.pc = pc;
            break;
          }
          case "call":
            if (t.stack.length >= 64) {
              this.block("脚本递归超过限制", op);
              return;
            }
            t.stack.push(t.pc);
            t.pc = op.target;
            break;
          case "wait":
            t.wait = Math.ceil(op.seconds * 100);
            t.wait *= 10;
            break;
          case "puppet":
            if (t.pending.some((p) => p.slot === op.slot)) {
              this.block("重复的角色演出槽", op);
              return;
            }
            t.pending.push(op);
            break;
          case "join":
            for (const p of t.pending.sort((a, b) => a.slot - b.slot)) {
              const c = this.task(t.script, p.target, p.actor);
              if (
                !this.hasEntity(p.actor) ||
                this.tasks.some(
                  (other) =>
                    !other.done && other.id !== t.id && other.actor === p.actor,
                )
              ) {
                this.block("角色演出归属冲突", op);
                return;
              }
              this.tasks.push(c);
              t.children.push(c.id);
            }
            t.pending = [];
            break;
          case "position":
            if (!actor) {
              this.block("非角色实体不能定位", op);
              return;
            }
            if (
              op.animation !== "" &&
              op.animation !== "Default" &&
              !this.content.characters[actor.asset]?.animations[op.animation]
            ) {
              this.block("尚未支持角色动画 " + op.animation, op);
              return;
            }
            if (op.animation && actor.animation) {
              try {
                actor.animation.cue(op.animation, -1);
              } catch (error) {
                this.block(
                  error instanceof Error ? error.message : String(error),
                  op,
                );
                return;
              }
            }
            actor.x = op.x;
            actor.y = op.y;
            this.hiddenEntities.delete(actor.id);
            // The mounted development renderer still derives its pose from facing.
            if (!actor.animation && op.animation === "WalkL")
              actor.direction = "left";
            break;
          case "move":
            t.move = op;
            t.remaining = op.steps;
            break;
          case "look":
            if (!actor) {
              this.block("非角色实体不能转向", op);
              return;
            }
            actor.direction = op.direction;
            try {
              actor.animation?.look(op.direction);
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "hide":
            if (this.tileAnimations.has(t.actor)) {
              this.block(
                "Tile animation visibility lifecycle is not implemented",
                op,
              );
              return;
            }
            this.hiddenEntities.add(t.actor);
            break;
          case "ride": {
            const rider = this.actors[op.actor];
            if (
              !rider ||
              op.vehicle !== 6 ||
              !this.content.entry.player.mount
            ) {
              this.block("未知骑乘对象", op);
              return;
            }
            rider.mount = this.content.entry.player.mount;
            rider.animation = null;
            break;
          }
          case "sound":
          case "sound-sync":
            // Explicit muted-development presentation lane, retained for later audio migration.
            this.presentationOmissions.push({
              site: op,
              kind: op.kind,
              soundId: op.kind === "sound" ? op.soundId : null,
            });
            break;
          case "fade-in":
            this.fade = { elapsed: 0, duration: Math.round(op.seconds * 1000) };
            t.wait = this.fade.duration;
            break;
          case "message":
            this.dialogue = {
              speaker: op.speaker,
              text: op.text,
              key: op.key,
              task: t.id,
            };
            return;
          case "encounter":
            if (this.treasureHandoffBlocked()) {
              this.block("宝箱任务尚未完成，尚不支持并发入战", op);
              return;
            }
            this.stop = {
              kind: "encounter",
              message: "此战斗尚未接入当前可玩片段。",
              site: op,
              party: op.party,
              continuation: op.continuation,
            };
            return;
          case "blocked":
            this.block(`${op.mnemonic}：${op.reason}`, op);
            return;
          default:
            this.block(`未知编译指令 ${op.kind}，需要重新编译内容`, op);
            return;
        }
      }
      if (!changed) {
        this.finishInteraction();
        this.finishMapEntry();
        return;
      }
    }
    this.block("脚本在一个逻辑步中未让出执行权");
  }
}
