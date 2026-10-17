import { GameSession, type GameCheckpoint } from "../core/game-session.js";
import { GameFlow } from "../core/game-flow.js";
import { GameCommands } from "../core/game-commands.js";
import { GameMapLoader } from "../core/game-map-loader.js";
import { GameBattleHandoff } from "../core/game-battle-handoff.js";
import type { GameContentRepository } from "../core/game-content.js";
import { CheckpointStorage } from "../core/saved-game.js";
import { contentDigest } from "../core/content-integrity.js";
import type { Direction, Site } from "../field/types.js";
import type { TargetSelection } from "../core/battle-targets.js";

/** Search data only. The game state remains exclusively in the existing owners. */
export type FrontierAction = { kind: "move"; direction: Direction } | { kind: "confirm" }
  | { kind: "choice"; index: number } | { kind: "close-shop" }
  | { kind: "battle"; actorId: string; abilityId: number; commandId: number; selection: TargetSelection }
  | { kind: "retry-battle" };
export type FrontierStep = { decisionHash: string; action: FrontierAction };
export type FrontierBundle = { game: GameSession; flow: GameFlow;
  contents: Pick<GameContentRepository, "world" | "map"> };
export type FrontierHost = {
  origin: "source-new-game" | "authored-mechanism";
  /** Trusted source entry evidence, usable even if preparation publishes no Session. */
  sourceWitness?: unknown;
  create(): Promise<FrontierBundle>;
  /** Input came from CheckpointStorage.load, never an edited checkpoint. */
  restore(checkpoint: GameCheckpoint): Promise<FrontierBundle>;
};
export type FrontierOptions = { maxRuns?: number; maxTicksPerRun?: number; maxTransitionsPerRun?: number;
  maxDepth?: number; maxBattleBranches?: number; maxGeometricVisits?: number;
  /** Resuming replays these complete prefixes from the real initializer; saved
   * bytes from an older report never become an unproven initial state. */
  initialPrefixes?: FrontierStep[][];
  /** Persist detached search evidence, not a second copy that can write gameplay. */
  persist?: (report: ReachableFrontierReport) => Promise<void> };
export type FrontierRecord = { kind: string; capability: string; mapId: number | null; message: string;
  sourceWitness: unknown; inputPrefix: FrontierStep[]; run: number; details?: unknown };
export type FrontierAnchor = { id: string; checkpointHash: string; serializedSlot: string;
  inputPrefix: FrontierStep[]; reason: "stable" | "source-event-save" };
export type ReachableFrontierReport = {
  kind: "reachable-source-frontiers-v1"; origin: FrontierHost["origin"]; result: "running" | "bounded-complete";
  exhaustive: false; sourceCampaignComplete: false; nativeParity: false;
  policy: { clockMs: 10; media: "controlled-immediate-ack"; stateDedup: "exact-checkpoint-hash";
    geometricSuppression: "bounded-observation-only-not-semantic-equivalence"; battleBranchLimit: number };
  limits: Required<Omit<FrontierOptions, "persist" | "initialPrefixes">>; anchors: FrontierAnchor[];
  runs: { id: number; inputPrefix: FrontierStep[]; fromAnchor: string | null; ticks: number;
    inputs: unknown[]; transitions: unknown[]; outcome: string; decision?: unknown; mapId: number | null }[];
  frontiers: FrontierRecord[]; groups: { capability: string; message: string; sites: number[] }[];
  reached: { checkpointHash: string; anchorId: string; mapId: number | null; x: number; y: number; layer: number | null }[];
  pending: { anchorId: string | null; tail: FrontierStep[]; inputPrefix: FrontierStep[] }[];
};
type Task = ReachableFrontierReport["pending"][number];
type Run = ReachableFrontierReport["runs"][number];
type Decision = { kind: "stable" | "choice" | "battle" | "shop" | "defeat"; hash: string;
  actions: FrontierAction[]; witness: unknown; observation: unknown };
const ready = { visible: true, mediaReady: true, overlayOpen: false };
const directions: Direction[] = ["up", "right", "down", "left"];
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const mapId = (bundle: FrontierBundle) => bundle.game.field.content.map.identity?.mapId ?? null;
function witness(bundle: FrontierBundle): unknown {
  const field = bundle.game.field;
  if (field.stop?.site) return structuredClone(field.stop.site);
  if (field.choice) {
    const choices = field.content.scripts;
    return Object.values(choices).flat().filter(op => op.kind === "choice" &&
      JSON.stringify(op.options) === JSON.stringify(field.choice!.options)).map(op => structuredClone(op));
  }
  return { mapId: mapId(bundle), source: field.content.map.source, entry: field.content.entry.evidence,
    interaction: (() => { try { return field.interactionTarget()?.source ?? null; }
      catch(error) { return { unavailableBecause: errorText(error) }; } })() };
}
function navigationObservation(bundle: FrontierBundle): unknown {
  const { game } = bundle, field = game.field;
  return clean({ content: field.content.contentHash, owned: game.state.snapshot(), events: field.eventState.snapshot(),
    groups: [...field.activeGroups], transport: field.transportationId,
    player: { x: field.player.x, y: field.player.y, layer: field.player.layer, direction: field.player.direction,
      asset: field.player.asset, mount: field.player.mount },
    actors: Object.values(field.actors).map(a => ({ id: a.id, x: a.x, y: a.y, layer: a.layer, direction: a.direction,
      visible: field.isEntityVisible(a.id), motion: a.motion, asset: a.asset, mount: a.mount })),
    collision: field.collisionState, updateMask: field.updateAttributeMask, routes: field.assignedRouteSnapshot });
}

/** Bounded BFS over real input decisions. Every fork uses an actual legal save
 * or replays an input prefix from the original initializer. No VM entry, flag,
 * resource, roster or position setter is used by this controller. */
export async function exploreReachableFrontiers(host: FrontierHost, options: FrontierOptions = {}): Promise<ReachableFrontierReport> {
  const limits = { maxRuns: options.maxRuns ?? 48, maxTicksPerRun: options.maxTicksPerRun ?? 24000,
    maxTransitionsPerRun: options.maxTransitionsPerRun ?? 16, maxDepth: options.maxDepth ?? 96,
    maxBattleBranches: options.maxBattleBranches ?? 1, maxGeometricVisits: options.maxGeometricVisits ?? 1 };
  if (Object.values(limits).some(v => !Number.isSafeInteger(v) || v < 1)) throw new Error("Invalid frontier search budget");
  if (!["source-new-game", "authored-mechanism"].includes(host.origin)) throw new Error("Unknown frontier search origin");
  const report: ReachableFrontierReport = { kind: "reachable-source-frontiers-v1", origin: host.origin, result: "running",
    exhaustive: false, sourceCampaignComplete: false, nativeParity: false,
    policy: { clockMs: 10, media: "controlled-immediate-ack", stateDedup: "exact-checkpoint-hash",
      geometricSuppression: "bounded-observation-only-not-semantic-equivalence", battleBranchLimit: limits.maxBattleBranches },
    limits, anchors: [], runs: [], frontiers: [], groups: [], reached: [], pending: (options.initialPrefixes ?? [[]]).map(prefix => ({ anchorId: null, tail: structuredClone(prefix), inputPrefix: structuredClone(prefix) })) };
  if (!report.pending.length) throw new Error("No frontier prefixes to replay");
  const anchorById = new Map<string, FrontierAnchor>(), exact = new Set<string>(), geometric = new Map<string, number>();
  const addFrontier = (bundle: FrontierBundle, run: Run, kind: string, capability: string, message: string, details?: unknown): void => {
    report.frontiers.push(clean({ kind, capability, mapId: mapId(bundle), message, sourceWitness: witness(bundle),
      inputPrefix: run.inputPrefix, run: run.id, ...(details === undefined ? {} : { details }) }));
  };
  const store = async (checkpoint: GameCheckpoint, prefix: FrontierStep[], reason: FrontierAnchor["reason"], publish?: (write: () => void) => void): Promise<FrontierAnchor> => {
    const bytes = new Map<string, string>(), storage = new CheckpointStorage({ getItem: k => bytes.get(k) ?? null,
      setItem: (k, v) => { bytes.set(k, v); } }, "framework", "reachable-frontier-audit");
    const prepared = await storage.prepareSave(checkpoint, report.anchors.length);
    if (publish) publish(() => prepared.commit()); else prepared.commit();
    const decoded = await storage.load();
    if (!decoded || await contentDigest(decoded.checkpoint) !== await contentDigest(checkpoint)) throw new Error("Frontier save round trip changed actual state");
    const checkpointHash = await contentDigest(decoded.checkpoint), id = "anchor-" + report.anchors.length;
    const anchor = { id, checkpointHash, serializedSlot: [...bytes.values()][0]!, inputPrefix: structuredClone(prefix), reason };
    report.anchors.push(anchor); anchorById.set(id, anchor); return anchor;
  };
  const restore = async (anchor: FrontierAnchor): Promise<FrontierBundle> => {
    const storage = new CheckpointStorage({ getItem: () => anchor.serializedSlot, setItem: () => { throw new Error("Read-only frontier restore slot"); } }, "framework", "reachable-frontier-audit");
    const saved = await storage.load();
    if (!saved || await contentDigest(saved.checkpoint) !== anchor.checkpointHash) throw new Error("Frontier anchor integrity changed");
    return host.restore(saved.checkpoint);
  };
  const tick = (bundle: FrontierBundle, run: Run) => { bundle.flow.advance(10, ready); run.ticks++; };
  async function seek(bundle: FrontierBundle, run: Run): Promise<Decision | null> {
    const { game, flow } = bundle, commands = new GameCommands(flow, game);
    const loader = new GameMapLoader(flow, bundle.contents, { prepare: async () => undefined, discard() {} });
    const handoff = new GameBattleHandoff(flow, { prepareStart: async () => undefined, prepareReturn: async () => undefined, discard() {} });
    while (run.ticks < limits.maxTicksPerRun) {
      const field = game.field;
      if (field.stop?.kind === "unsupported") {
        addFrontier(bundle, run, "unsupported", "field-vm", field.stop.message, field.stop); return null;
      }
      if (field.stop?.kind === "map-transition") {
        if (run.transitions.length >= limits.maxTransitionsPerRun) {
          addFrontier(bundle, run, "budget", "map-lifecycle", "Map transition budget exhausted", field.stop); return null;
        }
        const request = structuredClone(field.stop), before = await contentDigest(game.state.snapshot());
        const loaded = await loader.load();
        if (loaded.status !== "committed") {
          if (game.field !== field || await contentDigest(game.state.snapshot()) !== before) throw new Error("Failed map preparation changed the source owner");
          addFrontier(bundle, run, "map-provider", "map-lifecycle", loaded.status === "failed" ? errorText(loaded.error) : "Map load cancelled", request); return null;
        }
        run.transitions.push({ from: request.site, request: request.request, to: mapId(bundle), source: loaded.field.content.map.source });
        continue;
      }
      if (game.battleStartRequest) {
        const request = structuredClone(game.battleStartRequest), result = await handoff.start();
        if (result.status !== "committed") { addFrontier(bundle, run, "battle-provider", "battle-entry", result.status === "failed" ? errorText(result.error) : "Battle start cancelled", request); return null; }
        run.inputs.push({ kind: "automatic-battle-handoff", encounter: game.battle!.content.encounterId }); continue;
      }
      if (game.eventSaveRequest) {
        const prepared = game.prepareEventSave(game.eventSaveRequest), anchor = await store(prepared.checkpoint, run.inputPrefix, "source-event-save", write => prepared.commitWith(write));
        run.inputs.push({ kind: "source-event-save", anchor: anchor.id }); tick(bundle, run); continue;
      }
      if (game.battle) {
        const battle = game.battle;
        if (battle.phase === "victory" || battle.phase === "escaped" || battle.phase === "forced") {
          const result = await handoff.return();
          if (result.status !== "committed") { addFrontier(bundle, run, "battle-provider", "battle-return", result.status === "failed" ? errorText(result.error) : "Battle return cancelled"); return null; }
          run.inputs.push({ kind: "automatic-battle-return", outcome: battle.phase, encounter: battle.content.encounterId }); tick(bundle, run); continue;
        }
        if (battle.phase === "defeat") {
          const observation = { encounter: battle.content.encounterId, phase: battle.phase, players: battle.players.map(p => ({ id: p.id, hp: p.hp, mp: p.mp })) };
          return { kind: "defeat", hash: await contentDigest(observation), actions: [{ kind: "retry-battle" }], witness: witness(bundle), observation };
        }
        if (battle.ready.length) {
          const menus = battle.ready.map(actor => ({ actorId: actor.id, menu: battle.commandMenu(actor.id) }));
          const actions: FrontierAction[] = menus.flatMap(({ actorId, menu }) => menu.filter(c => c.kind === "ability" && c.available)
            .flatMap(command => command.abilityIds.flatMap(abilityId => battle.targetChoices(actorId, abilityId).map(choice =>
              ({ kind: "battle" as const, actorId, commandId: command.id, abilityId, selection: choice.selection })))));
          if (!actions.length) { addFrontier(bundle, run, "battle-input", "battle-command", "Ready actors have no admitted legal ability input", menus); return null; }
          const observation = clean({ encounter: battle.content.encounterId, time: battle.time, menus,
            units: battle.combatants.map(p => ({ id: p.id, hp: p.hp, mp: p.mp, conditions: p.conditionIds })), actions });
          if (actions.length > limits.maxBattleBranches) addFrontier(bundle, run, "budget", "battle-command-search", "Other legal battle inputs retained outside branch budget", actions.slice(limits.maxBattleBranches));
          return { kind: "battle", hash: await contentDigest(observation), actions: actions.slice(0, limits.maxBattleBranches), witness: witness(bundle), observation };
        }
      } else if (field.choice) {
        const observation = { mapId: mapId(bundle), options: field.choice.options, presentation: field.choice.presentation, anchor: field.choice.anchor };
        return { kind: "choice", hash: await contentDigest(observation), actions: field.choice.options.map((_, index) => ({ kind: "choice", index })), witness: witness(bundle), observation };
      } else if (field.dialogue && (!field.dialogue.manual || field.time >= field.dialogue.manual.availableAt) || field.sourceMessage.projection?.acceptsInput) {
        const before = clean({ dialogue: field.dialogue, source: field.sourceMessage.projection });
        run.inputs.push({ kind: "automatic-confirm", time: field.time, before, dispatched: flow.confirm() }); tick(bundle, run); continue;
      } else if (field.currentShop) {
        const observation = { mapId: mapId(bundle), group: field.currentShop.groupId };
        return { kind: "shop", hash: await contentDigest(observation), actions: [{ kind: "close-shop" }], witness: witness(bundle), observation };
      } else if (game.checkpointReady) {
        const checkpoint = game.checkpoint(), observation = navigationObservation(bundle);
        const actions: FrontierAction[] = directions.map(direction => ({ kind: "move", direction }));
        if (field.interactionTarget()) actions.push({ kind: "confirm" });
        return { kind: "stable", hash: await contentDigest(checkpoint), actions, witness: witness(bundle), observation };
      }
      tick(bundle, run);
    }
    addFrontier(bundle, run, "budget", "logical-clock", "Logical tick budget exhausted without another input barrier"); return null;
  }
  async function input(bundle: FrontierBundle, action: FrontierAction, run: Run): Promise<void> {
    const { game, flow } = bundle, commands = new GameCommands(flow, game);
    const source = witness(bundle), ticket = game.field.choice?.id ?? null;
    let accepted: boolean;
    if (action.kind === "move") accepted = flow.move(action.direction);
    else if (action.kind === "confirm") accepted = flow.confirm();
    else if (action.kind === "choice") accepted = !!game.field.choice && flow.choose(game.field.choice.id, action.index);
    else if (action.kind === "close-shop") accepted = commands.closeShop(game.field.currentShop?.id);
    else if (action.kind === "retry-battle") {
      const result = await new GameBattleHandoff(flow, { prepareStart: async () => undefined, prepareReturn: async () => undefined, discard() {} }).retry();
      accepted = result.status === "committed";
    } else accepted = !!game.battle && commands.command(game.battle, action.actorId, action.abilityId, action.selection, action.commandId);
    run.inputs.push({ kind: "decision-input", time: game.field.time, action, accepted, source, choiceTicket: ticket });
    if (!accepted && action.kind !== "move") throw new Error("Previously enumerated input was rejected: " + action.kind);
    tick(bundle, run);
  }
  while (report.pending.length && report.runs.length < limits.maxRuns) {
    const task = report.pending.shift()!, run: Run = { id: report.runs.length, inputPrefix: structuredClone(task.anchorId === null ? [] : anchorById.get(task.anchorId)!.inputPrefix),
      fromAnchor: task.anchorId, ticks: 0, inputs: [], transitions: [], outcome: "running", mapId: null };
    report.runs.push(run); let bundle: FrontierBundle | undefined;
    try {
      bundle = task.anchorId === null ? await host.create() : await restore(anchorById.get(task.anchorId)!);
      if (bundle.flow.currentSession !== bundle.game || !bundle.flow.started || bundle.game.state.snapshot().initialization !== "source-new-game")
        throw new Error("Frontier host must bind a started, genuinely initialized shared session");
      bundle.flow.observeHost(ready);
      let decision = await seek(bundle, run);
      for (const step of task.tail) {
        if (!decision) break;
        if (decision.hash !== step.decisionHash || !decision.actions.some(action => JSON.stringify(action) === JSON.stringify(step.action))) {
          addFrontier(bundle, run, "replay-diverged", "input-replay", "Actual decision no longer matches the recorded input prefix", { expected: step, actual: decision }); decision = null; break;
        }
        run.inputPrefix.push(structuredClone(step));
        await input(bundle, step.action, run); decision = await seek(bundle, run);
      }
      run.mapId = mapId(bundle);
      if (!decision) { run.outcome = "frontier"; }
      else {
        run.decision = clean(decision); run.outcome = decision.kind;
        if (run.inputPrefix.length >= limits.maxDepth) addFrontier(bundle, run, "budget", "input-depth", "Decision prefix depth exhausted", decision);
        else {
          let anchorId = task.anchorId, tail = task.tail;
          let expand = true;
          if (decision.kind === "stable") {
            const stateHash = decision.hash;
            if (exact.has(stateHash)) { run.outcome = "exact-duplicate"; expand = false; }
            else {
              exact.add(stateHash); const anchor = await store(bundle.game.checkpoint(), run.inputPrefix, "stable");
              report.reached.push({ checkpointHash: stateHash, anchorId: anchor.id, mapId: run.mapId,
                x: bundle.game.field.player.x, y: bundle.game.field.player.y, layer: bundle.game.field.player.layer });
              anchorId = anchor.id; tail = [];
              const geometryHash = await contentDigest(decision.observation), visits = geometric.get(geometryHash) ?? 0;
              geometric.set(geometryHash, visits + 1);
              if (visits >= limits.maxGeometricVisits) {
                addFrontier(bundle, run, "bounded-revisit", "geometric-planner", "Repeated geometric observation suppressed; semantic equivalence is unproven", { stateHash, geometryHash }); expand = false;
              }
            }
          }
          if (expand) for (const action of decision.actions) {
            const step = { decisionHash: decision.hash, action };
            report.pending.push({ anchorId, tail: [...tail, step], inputPrefix: [...run.inputPrefix, step] });
          }
        }
      }
    } catch (error) {
      run.outcome = "driver-or-provider-error";
      const details = { stack: error instanceof Error ? error.stack : null };
      if (!bundle) report.frontiers.push(clean({ kind: "entry-provider-error", capability: task.anchorId === null ? "new-game-entry" : "checkpoint-restore",
        mapId: null, message: errorText(error), sourceWitness: host.sourceWitness ?? null,
        inputPrefix: run.inputPrefix, run: run.id, details }));
      else { run.mapId = mapId(bundle); addFrontier(bundle, run, "provider-error", "shared-public-api", errorText(error), details); }
    }
    await options.persist?.(clean(report));
  }
  if (report.pending.length) report.frontiers.push({ kind: "budget", capability: "search-runs", mapId: null,
    message: "Global run budget exhausted; all queued prefixes retained", sourceWitness: null, inputPrefix: [], run: report.runs.length,
    details: { queued: report.pending.length } });
  const groups = new Map<string, { capability: string; message: string; sites: number[] }>();
  report.frontiers.forEach((frontier, index) => { const key = frontier.capability + "\\0" + frontier.message;
    const group = groups.get(key) ?? { capability: frontier.capability, message: frontier.message, sites: [] }; group.sites.push(index); groups.set(key, group); });
  report.groups = [...groups.values()]; report.result = "bounded-complete"; await options.persist?.(clean(report)); return report;
}
