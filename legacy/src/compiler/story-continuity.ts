import { createHash } from "node:crypto";
import { z } from "zod";
import { canonical } from "../core/canonical.js";
import { EventState, UnknownEventValue, validVariable } from "../core/event-state.js";
import { parseGameContentRefs } from "../core/game-content-refs.js";
import type { GameCheckpoint } from "../core/game-session.js";
import type { GameStateSnapshot } from "../core/game-state.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).refine(value => value.trim() === value);
const integer = z.number().int().min(-0x80000000).max(0x7fffffff);
const id = integer.min(1);
const count = integer.min(0);
const fingerprints = z.record(text, digest).refine(value => Object.keys(value).length > 0,
  "At least one explicit source fingerprint is required");
const contentRefs = z.unknown().transform((raw, context) => {
  try { return parseGameContentRefs(raw); }
  catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : String(error) });
    return z.NEVER;
  }
});
const binding = z.object({ sourceSetHash: digest, sourceFingerprints: fingerprints,
  runtimeHash: digest, contentRefs, contentHashes: fingerprints }).strict();
const ref = z.object({ category: z.enum(["ScenarioFlag1", "ScenarioFlag2", "ScenarioFlag3", "ScenarioFlag4",
  "TreasureFlag1", "TreasureFlag2", "TreasureFlag3", "TreasureFlag4", "ScenarioVariable",
  "AreaLocalVariable", "MapLocalVariable"]), index: integer }).strict().refine(validVariable,
    "Expected an exact valid persistent event reference");
const flag = z.object({ ref, value: integer }).strict().refine(({ ref: address, value }) =>
  !address.category.includes("Flag") || value === 0 || value === 1, "Flags are exact zero or one");
const rosterMember = z.object({ id: text, sourceId: id, ownedId: id, enabled: z.boolean() }).strict();
const cell = z.object({ id: text.nullable(), row: z.enum(["front", "back"]) }).strict();
const slot = z.tuple([cell, cell, cell, cell]);
const party = z.object({ selectedSlot: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  slots: z.tuple([slot, slot, slot]) }).strict();
const item = z.object({ id, count }).strict();
const settled = z.object({ serial: count, encounterId: id,
  outcome: z.enum(["victory", "escaped", "forced", "forced-save"]) }).strict();
const expectation = z.object({ mapId: id.nullable(), flags: z.array(flag),
  roster: z.array(rosterMember).nullable(), party: party.nullable(), gil: count.nullable(),
  items: z.array(item), equipmentStock: z.array(item).optional() }).strict();
const schema = z.object({ kind: z.literal("story-route-contract-v1"), id: text, binding,
  entry: expectation, exit: expectation,
  changes: z.object({ gil: integer.nullable(), items: z.array(z.object({ id, count: integer }).strict()),
    equipmentStock: z.array(z.object({ id, count: integer }).strict()).optional(),
    completedBattles: z.array(settled).nullable() }).strict() }).strict().superRefine((value, context) => {
  const distinct = (values: (string | number)[], path: string) => {
    if (new Set(values).size !== values.length)
      context.addIssue({ code: "custom", message: "Duplicate identity: " + path });
  };
  for (const side of ["entry", "exit"] as const) {
    const e = value[side];
    // Aliases in the source's four 256-bit categories address the same bank.
    // Preserve each declared ref but reject overlapping physical addresses.
    distinct(e.flags.map(({ ref: r }) => {
      const match = /^(Scenario|Treasure)Flag([1-4])$/.exec(r.category);
      return match ? `${match[1]}:${(Number(match[2]) - 1) * 256 + r.index}` : `${r.category}:${r.index}`;
    }), side + ".flags");
    distinct(e.items.map(i => i.id), side + ".items");
    if (e.equipmentStock !== undefined) distinct(e.equipmentStock.map(i => i.id), side + ".equipmentStock");
    if (e.roster !== null) {
      distinct(e.roster.map(m => m.id), side + ".roster.id");
      distinct(e.roster.map(m => m.ownedId), side + ".roster.ownedId");
    }
  }
  distinct(value.changes.items.map(i => i.id), "changes.items");
  if (value.changes.equipmentStock !== undefined)
    distinct(value.changes.equipmentStock.map(i => i.id), "changes.equipmentStock");
  if (value.changes.completedBattles !== null)
    distinct(value.changes.completedBattles.map(b => b.serial), "changes.completedBattles.serial");
});

/** Compiler-owned assertions against existing state. This is neither a save
 * format nor a source initializer; it cannot create or repair game state. */
export type StoryRouteContract = z.infer<typeof schema>;
export type StoryRouteBinding = StoryRouteContract["binding"];
export function parseStoryRouteContract(raw: unknown): StoryRouteContract { return schema.parse(raw); }

/** The batch runner's existing capture, with one optional stable entry
 * checkpoint. A missing entry stays unknown rather than being seeded. */
export type StoryRouteCapture = {
  initialOwned: GameStateSnapshot | null;
  finalOwned: GameStateSnapshot | null;
  checkpoint: GameCheckpoint | null;
  firstStableCheckpoint?: GameCheckpoint | null;
};
export type StoryContinuityIssue = { code: string; path: string; status: "mismatch" | "unknown"; detail: string };
export type StoryContinuityTranscript = {
  path: string; status: "passed" | "mismatch" | "unknown"; expected: unknown; observed: unknown;
};
export type StoryContinuityResult = {
  kind: "story-route-continuity-result-v1";
  status: "passed" | "mismatch" | "unknown";
  scope: "declared-state-contract-only";
  issues: StoryContinuityIssue[];
  transcript: StoryContinuityTranscript[];
  sourceStoryReachable: false;
  originalGameExecuted: false;
};
function resultCollector() {
  const issues: StoryContinuityIssue[] = [], transcript: StoryContinuityTranscript[] = [];
  const unknown = (path: string, code: string, detail: string, expected: unknown = null) => {
    issues.push({ path, code, status: "unknown", detail });
    transcript.push({ path, status: "unknown", expected: structuredClone(expected), observed: null });
  };
  const check = (path: string, expected: unknown, observed: unknown, code = "state-mismatch") => {
    const matched = canonical(expected) === canonical(observed);
    transcript.push({ path, status: matched ? "passed" : "mismatch",
      expected: structuredClone(expected), observed: structuredClone(observed) });
    if (!matched) issues.push({ path, code, status: "mismatch", detail: "Observed projection differs from the exact declaration" });
  };
  const done = (): StoryContinuityResult => ({ kind: "story-route-continuity-result-v1",
    status: issues.some(i => i.status === "mismatch") ? "mismatch" : issues.length ? "unknown" : "passed",
    scope: "declared-state-contract-only", issues, transcript, sourceStoryReachable: false, originalGameExecuted: false });
  return { unknown, check, done };
}

/** Reads only the original checkpoint/owned projections. Passing this
 * assertion does not establish source-story reachability or original parity. */
export function assessStoryRouteContinuity(rawContract: unknown, input: {
  binding: StoryRouteBinding; capture: StoryRouteCapture;
}): StoryContinuityResult {
  const r = resultCollector();
  let contract: StoryRouteContract, trusted: StoryRouteBinding;
  try { contract = parseStoryRouteContract(rawContract); trusted = binding.parse(input.binding); }
  catch (error) {
    r.unknown("contract", "invalid-contract-or-binding", error instanceof Error ? error.message : String(error));
    return r.done();
  }
  r.check("binding", contract.binding, trusted, "binding-mismatch");
  const capture = input.capture;
  if (!capture || typeof capture !== "object") {
    r.unknown("capture", "invalid-capture", "Expected the existing runner's read-only state capture");
    return r.done();
  }
  const first = capture.firstStableCheckpoint ?? null, last = capture.checkpoint ?? null;
  const initial = first?.owned ?? capture.initialOwned, final = last?.owned ?? capture.finalOwned;
  const checkCheckpointBinding = (side: string, cp: GameCheckpoint | null) => {
    if (cp === null) { r.unknown(side + ".checkpoint", "missing-checkpoint", "No stable checkpoint was captured"); return; }
    r.check(side + ".sourceSetHash", trusted.sourceSetHash, cp.sourceSetHash, "source-set-mismatch");
    const refs = trusted.contentRefs;
    const entry = cp.origin.kind === "source-new-game" ? refs.source
      : cp.origin.kind === "framework-new-game" ? (refs.kind === "game-content-refs-v2" ? refs.initialized : null)
        : refs.development;
    if (!entry) { r.unknown(side + ".origin", "missing-trusted-entry", "No trusted refs for this checkpoint origin"); return; }
    r.check(side + ".battleCatalogHash", entry.battle.contentHash, cp.battleCatalogHash, "content-pin-mismatch");
    r.check(side + ".owned.catalogHash", entry.battle.contentHash, cp.owned.catalogHash, "content-pin-mismatch");
    r.check(side + ".world.initialHash", entry.entry.contentHash, cp.world.initialHash, "content-pin-mismatch");
    if (cp.origin.kind !== "development-checkpoint")
      r.check(side + ".origin.contentHash", entry.entry.contentHash,
        cp.origin.kind === "source-new-game" ? cp.origin.sourceContentHash : cp.origin.entryContentHash, "content-pin-mismatch");
    if (cp.world.location !== null) {
      r.check(side + ".world.catalogHash", refs.world.contentHash, cp.world.location.catalogHash, "content-pin-mismatch");
      if (cp.world.field.eventState.currentMapId !== null)
        r.check(side + ".event-map-owner", cp.world.location.mapId, cp.world.field.eventState.currentMapId, "event-map-owner-mismatch");
      const pin = trusted.contentHashes[`map:${cp.world.location.mapId}`];
      if (pin === undefined) r.unknown(side + ".field.contentHash", "missing-trusted-map", "Current map has no exact trusted content pin");
      else r.check(side + ".field.contentHash", pin, cp.world.field.contentHash, "content-pin-mismatch");
    } else {
      // Before WorldSession publishes its first location, the field is the
      // trusted origin entry wrapper, even when DataStorage knows its map ID.
      // Its digest cannot be replaced by the indexed world-map body. Once a
      // location exists, the exact map pin above is mandatory instead.
      r.check(side + ".field.contentHash", entry.entry.contentHash, cp.world.field.contentHash, "content-pin-mismatch");
    }
  };
  const checkState = (side: "entry" | "exit", cp: GameCheckpoint | null, owned: GameStateSnapshot | null) => {
    const expected = contract[side];
    checkCheckpointBinding(side, cp);
    if (expected.mapId !== null) {
      if (cp === null) r.unknown(side + ".mapId", "missing-checkpoint", "Map identity is unavailable", expected.mapId);
      else {
        const mapId = cp.world.location?.mapId ?? cp.world.field.eventState.currentMapId;
        if (mapId === null) r.unknown(side + ".mapId", "unknown-map", "Neither source location nor event state declares a map", expected.mapId);
        else r.check(side + ".mapId", expected.mapId, mapId, "map-mismatch");
      }
    }
    let events: EventState | null = null;
    if (cp !== null) {
      try { events = new EventState(cp.world.field.eventState); }
      catch (error) { r.unknown(side + ".events", "invalid-event-checkpoint", error instanceof Error ? error.message : String(error)); }
    }
    for (const f of expected.flags) {
      const path = `${side}.flags.${f.ref.category}[${f.ref.index}]`;
      if (events === null) r.unknown(path, "missing-event-state", "No validated event checkpoint", f.value);
      else {
        try { r.check(path, f.value, events.read(f.ref), "event-value-mismatch"); }
        catch (error) { r.unknown(path, error instanceof UnknownEventValue ? "unknown-event-value" : "invalid-event-reference",
          error instanceof Error ? error.message : String(error), f.value); }
      }
    }
    if (owned === null) { r.unknown(side + ".owned", "missing-owned-state", "No captured owned projection"); return; }
    if (expected.gil !== null) r.check(side + ".gil", expected.gil, owned.gil, "gil-mismatch");
    if (expected.roster !== null) r.check(side + ".roster", expected.roster,
      owned.roster.map(({ id, sourceId, ownedId, enabled }) => ({ id, sourceId, ownedId, enabled })), "roster-mismatch");
    if (expected.party !== null) r.check(side + ".party", expected.party, owned.party, "party-mismatch");
    for (const i of expected.items)
      r.check(`${side}.items.${i.id}`, i.count, owned.items.find(stack => stack.id === i.id)?.count ?? 0, "item-mismatch");
    for (const i of expected.equipmentStock ?? [])
      r.check(`${side}.equipmentStock.${i.id}`, i.count,
        owned.equipmentStock.find(stack => stack.id === i.id)?.count ?? 0, "equipment-stock-mismatch");
  };
  try {
    if (last !== null && capture.finalOwned !== null)
      r.check("exit.owner-projection", last.owned, capture.finalOwned, "owned-owner-mismatch");
    else r.unknown("exit.owner-projection", "missing-owned-owner-projection", "Final checkpoint and owned capture are both required");
    checkState("entry", first, initial); checkState("exit", last, final);
    if (initial === null || final === null) r.unknown("changes", "missing-owned-state", "Changes require both owned projections");
    else {
      if (contract.changes.gil !== null) r.check("changes.gil", contract.changes.gil, final.gil - initial.gil, "gil-delta-mismatch");
      for (const i of contract.changes.items) r.check(`changes.items.${i.id}`, i.count,
        (final.items.find(stack => stack.id === i.id)?.count ?? 0) - (initial.items.find(stack => stack.id === i.id)?.count ?? 0),
        "item-delta-mismatch");
      for (const i of contract.changes.equipmentStock ?? []) r.check(`changes.equipmentStock.${i.id}`, i.count,
        (final.equipmentStock.find(stack => stack.id === i.id)?.count ?? 0) -
          (initial.equipmentStock.find(stack => stack.id === i.id)?.count ?? 0), "equipment-stock-delta-mismatch");
      // Settled leases are append-only. A restore must never rewrite an old
      // receipt or grant the same lease twice, even on a zero-delta segment.
      r.check("changes.completedBattles.prefix", initial.completedBattles,
        final.completedBattles.slice(0, initial.completedBattles.length), "settled-history-rewritten");
      r.check("exit.completedBattles.unique", true,
        new Set(final.completedBattles.map(b => b.serial)).size === final.completedBattles.length, "duplicate-settled-lease");
      if (contract.changes.completedBattles !== null) r.check("changes.completedBattles", contract.changes.completedBattles,
        final.completedBattles.slice(initial.completedBattles.length), "battle-receipt-delta-mismatch");
    }
  } catch (error) {
    r.unknown("capture", "invalid-capture", error instanceof Error ? error.message : String(error));
  }
  return r.done();
}

/** Bytes are the original serialized checkpoint JSON payload, excluding any
 * storage envelope. The host supplies them; this checker never reserializes
 * a previous exit to manufacture a later entry. */
export type StoryCheckpointBytes = { checkpoint: GameCheckpoint | null; bytes: string | null; sha256: string | null };
export function assessStoryCheckpointLink(previous: StoryCheckpointBytes, next: StoryCheckpointBytes): StoryContinuityResult {
  const r = resultCollector();
  const inspect = (side: string, observation: StoryCheckpointBytes) => {
    if (observation.checkpoint === null || observation.bytes === null || observation.sha256 === null) {
      r.unknown(side, "missing-checkpoint-bytes", "Checkpoint, original payload bytes and SHA-256 are all required"); return;
    }
    r.check(side + ".sha256", createHash("sha256").update(observation.bytes, "utf8").digest("hex"),
      observation.sha256, "checkpoint-byte-hash-mismatch");
    try { r.check(side + ".payload", observation.checkpoint, JSON.parse(observation.bytes), "checkpoint-payload-mismatch"); }
    catch (error) { r.unknown(side + ".payload", "invalid-checkpoint-json", error instanceof Error ? error.message : String(error)); }
  };
  inspect("previous", previous); inspect("next", next);
  if (previous.bytes !== null && next.bytes !== null) r.check("link.bytes", previous.bytes, next.bytes, "checkpoint-chain-broken");
  if (previous.sha256 !== null && next.sha256 !== null) r.check("link.sha256", previous.sha256, next.sha256, "checkpoint-chain-broken");
  if (previous.checkpoint !== null && next.checkpoint !== null)
    r.check("link.checkpoint", previous.checkpoint, next.checkpoint, "checkpoint-chain-broken");
  return r.done();
}
