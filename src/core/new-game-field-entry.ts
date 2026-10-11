import { checkpointKeys } from "./checkpoint-validation.js";
import {
  FieldFadeState,
  type FieldFadeOp,
  type FieldFadeProjection,
} from "./field-fade.js";
import {
  cloneSourcePresentationContext,
  type SourcePresentationContext,
} from "./source-presentation.js";

export type NewGameFieldEntryDefinition = {
  kind: "source-new-game-field-entry-v1";
  mapId: number;
  entrance: number;
  reservedScript: { id: number; name: string; contentHash: string };
  /** LastSettings only tries this when the reserved script cannot start. */
  fallbackScript: { id: number; name: string };
};

/** These are acknowledgements from the owning scene/field preparation code,
 * never defaults inferred from a map id or from the new-game owned-state plan. */
export type NewGameFieldPreparation = {
  kind: "source-new-game-field-prepared-v1";
  mapId: number;
  entrance: number;
  reservedScriptName: string;
  firstLoad: true;
  mapLoadComplete: true;
  mapSetupComplete: true;
  mapViewSetupComplete: true;
  firstFieldSceneInitialized: true;
  fieldUiReady: true;
};

export type NewGameFieldEntryPhase =
  | "created"
  | "title-fading"
  | "scene-loading"
  | "scene-loaded"
  | "scene-activated"
  | "field-preparing"
  | "launched";

export type NewGameFieldEntryEffect =
  | { kind: "stop-title-bgm"; channel: 0; seconds: 2 }
  | { kind: "begin-map-load"; mapId: number; entrance: number }
  | { kind: "hide-title" }
  | { kind: "request-main-scene"; fromAdvertisement: false; useFade: false }
  | { kind: "activate-main-scene" }
  | { kind: "destroy-title" };

export type NewGameFieldLaunch = {
  mapId: number;
  entrance: number;
  scriptName: string;
  scriptContentHash: string;
  startChangeState: true;
  endChangeState: true;
  /** A successful reserved script bypasses SetupEntities/MapReady/map BGM/
   * automatic FadeIn/map title and the ordinary map initializer. */
  fallbackBranch: "discard-after-reserved-script";
  entrySynchronized: false;
  fade: FieldFadeState;
  sourcePresentation: SourcePresentationContext;
};

export type PreparedNewGameFieldTransition = {
  effects: readonly NewGameFieldEntryEffect[];
  /** The candidate global owner. The caller must publish it with the returned
   * effects; it must not reset it from a guessed entry color. */
  fade: FieldFadeState;
  commit(): void;
};

function integer(value: number, minimum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error("Invalid new-game field " + label);
}

function definition(value: NewGameFieldEntryDefinition): void {
  checkpointKeys(value, "kind,mapId,entrance,reservedScript,fallbackScript");
  if (value.kind !== "source-new-game-field-entry-v1")
    throw new Error("Invalid new-game field entry definition");
  integer(value.mapId, 1, "map identity");
  integer(value.entrance, 0, "entrance");
  checkpointKeys(value.reservedScript, "id,name,contentHash");
  checkpointKeys(value.fallbackScript, "id,name");
  integer(value.reservedScript.id, 1, "reserved script identity");
  integer(value.fallbackScript.id, 1, "fallback script identity");
  for (const name of [value.reservedScript.name, value.fallbackScript.name])
    if (typeof name !== "string" || !name.length)
      throw new Error("Unresolved new-game field script name");
  if (!/^[a-f0-9]{64}$/.test(value.reservedScript.contentHash))
    throw new Error("Unbound new-game reserved script content");
}

function ordinary(
  context: SourcePresentationContext,
): SourcePresentationContext {
  const checked = cloneSourcePresentationContext(context);
  if (
    checked?.origin !== "title-new-game" ||
    checked.advertisementOpeningFader !== "absent"
  )
    throw new Error(
      "New-game field entry requires proved ordinary title context",
    );
  return checked;
}

function preparation(
  receipt: NewGameFieldPreparation,
  value: NewGameFieldEntryDefinition,
): void {
  checkpointKeys(
    receipt,
    "kind,mapId,entrance,reservedScriptName,firstLoad,mapLoadComplete,mapSetupComplete,mapViewSetupComplete,firstFieldSceneInitialized,fieldUiReady",
  );
  if (
    receipt.kind !== "source-new-game-field-prepared-v1" ||
    receipt.mapId !== value.mapId ||
    receipt.entrance !== value.entrance ||
    receipt.reservedScriptName !== value.reservedScript.name ||
    receipt.firstLoad !== true ||
    receipt.mapLoadComplete !== true ||
    receipt.mapSetupComplete !== true ||
    receipt.mapViewSetupComplete !== true ||
    receipt.firstFieldSceneInitialized !== true ||
    receipt.fieldUiReady !== true
  )
    throw new Error("Unproved new-game field preparation");
}

const titleFade: FieldFadeOp = {
  kind: "field-fade",
  direction: "out",
  seconds: 0.5,
  color: { r: 0, g: 0, b: 0, a: 1 },
};

/** Ordinary title -> first field entry only. This protocol does not own a second
 * fade clock. Its owning host advances the one FieldFadeState, applies ordered
 * effects, and acknowledges real resource preparation. Transition preparation
 * is detached; a failed scene/field candidate cannot consume the launch.
 *
 * No active protocol checkpoint is supported. A restored game never replays
 * title initialization, and a missing title/fade host stays unsupported. */
export class NewGameFieldEntry {
  private phaseValue: NewGameFieldEntryPhase = "created";
  private revision = 0;
  private readonly value: NewGameFieldEntryDefinition;
  private readonly presentation: SourcePresentationContext;

  constructor(
    value: NewGameFieldEntryDefinition,
    context: SourcePresentationContext,
  ) {
    definition(value);
    this.value = structuredClone(value);
    this.presentation = ordinary(context);
  }

  get phase(): NewGameFieldEntryPhase {
    return this.phaseValue;
  }

  private transition(
    currentFade: FieldFadeState,
    nextFade: FieldFadeState,
    phase: NewGameFieldEntryPhase,
    effects: NewGameFieldEntryEffect[],
  ): PreparedNewGameFieldTransition {
    const revision = this.revision,
      before = JSON.stringify(currentFade.snapshot());
    let committed = false;
    return {
      effects: structuredClone(effects),
      fade: nextFade,
      commit: () => {
        if (
          committed ||
          revision !== this.revision ||
          before !== JSON.stringify(currentFade.snapshot())
        )
          throw new Error("Stale or repeated new-game field transition");
        committed = true;
        this.phaseValue = phase;
        this.revision++;
      },
    };
  }

  /** InitSelect: the host stops channel0 BGM before publishing this fade and
   * begins map preloading afterward. Resource loading runs during the fade.
   * Callback absence and active hierarchy are host facts, not inferred here. */
  prepareStart(
    currentFade: FieldFadeState,
    host: { active: true; callbacks: "absent" },
    frameDeltaSeconds = 0,
  ): PreparedNewGameFieldTransition {
    checkpointKeys(host, "active,callbacks");
    if (this.phaseValue !== "created")
      throw new Error("New-game field entry has already started");
    if (host.active !== true || host.callbacks !== "absent")
      throw new Error("Unresolved new-game fade hierarchy or callbacks");
    const next = currentFade.fork();
    next.start(titleFade, frameDeltaSeconds);
    return this.transition(currentFade, next, "title-fading", [
      { kind: "stop-title-bgm", channel: 0, seconds: 2 },
      {
        kind: "begin-map-load",
        mapId: this.value.mapId,
        entrance: this.value.entrance,
      },
    ]);
  }

  /** One source coroutine resume per committed transition. A request does not
   * also activate a scene in that call, even if its assets are already loaded.
   * The caller updates map loading before polling this title state. */
  prepareResume(
    currentFade: FieldFadeState,
    sceneLoadingComplete: boolean | null,
  ): PreparedNewGameFieldTransition | null {
    if (
      sceneLoadingComplete !== null &&
      typeof sceneLoadingComplete !== "boolean"
    )
      throw new Error("Invalid new-game scene readiness");
    if (this.phaseValue === "title-fading") {
      if (currentFade.poll("out") === "wait") return null;
      return this.transition(currentFade, currentFade.fork(), "scene-loading", [
        { kind: "hide-title" },
        {
          kind: "request-main-scene",
          fromAdvertisement: false,
          useFade: false,
        },
      ]);
    }
    if (this.phaseValue === "scene-loading") {
      if (sceneLoadingComplete !== true) return null;
      if (currentFade.poll("out") === "wait")
        return this.transition(
          currentFade,
          currentFade.fork(),
          "scene-loaded",
          [],
        );
      return this.transition(
        currentFade,
        currentFade.fork(),
        "scene-activated",
        [{ kind: "activate-main-scene" }],
      );
    }
    if (this.phaseValue === "scene-loaded") {
      if (currentFade.poll("out") === "wait") return null;
      return this.transition(
        currentFade,
        currentFade.fork(),
        "scene-activated",
        [{ kind: "activate-main-scene" }],
      );
    }
    if (this.phaseValue === "scene-activated")
      return this.transition(
        currentFade,
        currentFade.fork(),
        "field-preparing",
        [{ kind: "destroy-title" }],
      );
    if (this.phaseValue === "field-preparing") return null;
    throw new Error("New-game field entry cannot resume in " + this.phaseValue);
  }

  /** A native successful reserved-script branch inherits the existing fader.
   * There is deliberately no automatic fade-in or initializer fallback. Unknown
   * or unsupported reserved scripts must block the candidate, not select map609's
   * different script and quietly turn this into a development checkpoint. */
  prepareLaunch(
    currentFade: FieldFadeState,
    receipt: NewGameFieldPreparation,
  ): { launch: NewGameFieldLaunch; commit(): void } {
    if (this.phaseValue !== "field-preparing")
      throw new Error("New-game field launch precedes scene handoff");
    preparation(receipt, this.value);
    if (!currentFade.known)
      throw new Error("Unknown new-game field fade owner");
    const next = currentFade.fork(),
      transaction = this.transition(currentFade, next, "launched", []);
    return {
      launch: {
        mapId: this.value.mapId,
        entrance: this.value.entrance,
        scriptName: this.value.reservedScript.name,
        scriptContentHash: this.value.reservedScript.contentHash,
        startChangeState: true,
        endChangeState: true,
        fallbackBranch: "discard-after-reserved-script",
        entrySynchronized: false,
        fade: next,
        sourcePresentation: { ...this.presentation },
      },
      commit: transaction.commit,
    };
  }
}

/** Native fade completion observes alpha, not duration or the tween's activity.
 * Exposed for host diagnostics without serializing the protocol as a game save. */
export function newGameTitleFadeComplete(
  value: FieldFadeProjection | null,
): boolean {
  if (value === null) return false;
  const fade = new FieldFadeState(value);
  return fade.poll("out") === "next";
}
