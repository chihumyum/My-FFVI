import type { FieldGameOptions } from "./field.js";

// This exact opt-in is declared by the concurrent story-execution contract. It
// stays optional and inert until Field installs that independently owned port.
type FieldPortOptions = FieldGameOptions & {
  sourceStoryExecution?: "source-story-execution-evidence-v1";
};
type Route = "shared" | "entry" | "stable" | "local";
/** Every Field option must choose a lifetime explicitly. New options cannot
 * silently disappear from map preparation or acquire forwarding by a spread.
 * `entry` hosts are rebuilt by World for a destination; `stable` ports already
 * belong to the session; `local` ports/seeds belong to its actual draft/map. */
export const FIELD_RUNTIME_PORT_ROUTES = Object.freeze({
  fieldLayerScrolling: "shared",
  fieldLayerScrollingSeed: "local",
  sourceFieldUi: "shared",
  sourceFieldUiSeed: "local",
  fieldLocation: "local",
  retainedWorldTransportation: "shared",
  assignedNpcRoutes: "shared",
  sourceCharacterNaming: "shared",
  rtsPartySwitch: "shared",
  sourcePartySelection: "shared",
  sourceBossEntry: "shared",
  sourceNonEncounterAreas: "shared",
  skyboxPresentation: "shared",
  screenPresentation: "shared",
  cameraShake: "shared",
  viewChange: "shared",
  worldAutoMove: "shared",
  worldAutoTasks: "shared",
  birdViewActors: "shared",
  mobColorFilter: "shared",
  fieldEffectTransforms: "shared",
  sourceSnapshot: "shared",
  sourceMessageReady: "shared",
  sourceMessageSequence: "shared",
  audioReadiness: "shared",
  soundPresentation: "shared",
  conditionLeaderActivity: "shared",
  transportationTimestamp: "shared",
  vehicleLifecycle: "shared",
  transportationParkingUpload: "shared",
  sourceStoryExecution: "shared",
  puppetRoutes: "entry",
  fieldEffects: "entry",
  contentInvalidations: "stable",
  sourceEncounter: "stable",
  sourceBattleResult: "stable",
  messageFees: "stable",
  reservedScripts: "stable",
  characterNamingPort: "local",
  rtsParty: "local",
  sourcePartySelectionPort: "local",
  deferLogicalEffectRestore: "local",
  storyRuntimeSeed: "local",
  storyTimerOrigin: "local",
  fieldEffectMap: "local",
  nativeActorPreparation: "local",
  npcActivityClock: "local",
  sourceMessageEffects: "local",
  messageFeeSeed: "local",
  puppetActors: "local",
  puppetRoster: "local",
  playerVisibility: "local",
  sourcePresentation: "local",
  shop: "local",
  ownedConditions: "local",
  recovery: "local",
  scriptRandom: "local",
  inventory: "local",
  messageNames: "local",
  treasure: "local",
  party: "local",
  roster: "local",
  fieldSteps: "local",
  walkEncounters: "local",
  partyAppearance: "local",
  transportation: "local",
  movementBlocker: "local",
} as const satisfies Record<keyof FieldPortOptions, Route>);
type KeysFor<R extends Route> = { [K in keyof typeof FIELD_RUNTIME_PORT_ROUTES]:
  (typeof FIELD_RUNTIME_PORT_ROUTES)[K] extends R ? K : never
}[keyof typeof FIELD_RUNTIME_PORT_ROUTES];
export type SharedFieldRuntimePorts = Pick<FieldPortOptions, KeysFor<"shared" | "entry">>;
type MapFieldRuntimePorts = Pick<FieldPortOptions, KeysFor<"shared" | "stable">>;

export function forwardFieldRuntimePorts(source: SharedFieldRuntimePorts | undefined, phase: "session"): SharedFieldRuntimePorts;
export function forwardFieldRuntimePorts(source: FieldPortOptions | undefined, phase: "entry"): FieldPortOptions;
export function forwardFieldRuntimePorts(source: FieldPortOptions | undefined, phase: "map"): MapFieldRuntimePorts;
/** Copy only declared values. Host instances, private brands and callbacks keep
 * identity. No host is constructed/serialized, no missing port gets a default,
 * and no content/runtime marker is interpreted as authorization here. */
export function forwardFieldRuntimePorts(source: SharedFieldRuntimePorts | FieldPortOptions | undefined,
  phase: "session" | "entry" | "map"): FieldPortOptions {
  if (!["session", "entry", "map"].includes(phase)) throw new Error("Unknown Field runtime forwarding phase");
  if (source === undefined) return {};
  if (source === null || typeof source !== "object") throw new Error("Field runtime forwarding requires an options object");
  const next: Partial<Record<keyof FieldPortOptions, unknown>> = {};
  for (const key of Object.keys(FIELD_RUNTIME_PORT_ROUTES) as (keyof FieldPortOptions)[]) {
    const route = FIELD_RUNTIME_PORT_ROUTES[key];
    const include = phase === "entry" || route === "shared" || (phase === "session" ? route === "entry" : route === "stable");
    if (!include || !Object.prototype.propertyIsEnumerable.call(source, key)) continue;
    const value = (source as FieldPortOptions)[key];
    if (value !== undefined) next[key] = value;
  }
  return next as FieldPortOptions;
}
