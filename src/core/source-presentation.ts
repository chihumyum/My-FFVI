import { checkpointKeys } from "./checkpoint-validation.js";
import { EventState, type VariableRef } from "./event-state.js";

/** This is a scene-host fact, not a story flag and not a property of a map.
 * Unknown is intentional for imports and development checkpoints that did not
 * pass through the title/new-game lifecycle. */
export type SourcePresentationContext = {
  kind: "source-presentation-context-v1";
  advertisementOpeningFader: "absent" | "present" | "unknown";
  origin: "title-new-game" | "advertisement-opening" | "unresolved";
};

export type SourcePresentationEntry =
  | {
      kind: "title-new-game";
      /** Advertisement.Start has completed its old-fader destruction. */
      titleCleanupComplete: true;
      /** The ordinary selection did not run Advertisement's PlayOpening callback. */
      openingCallbackStarted: false;
    }
  | { kind: "advertisement-opening"; faderSetupComplete: true }
  | { kind: "unresolved" };

export type SourcePresentationCommand =
  { kind: "advertisement-probe" } | { kind: "advertisement-return-to-title" };

export type SourcePresentationOp = {
  kind: "source-presentation";
  command: SourcePresentationCommand;
};

/** Ordered native host calls. A missing host must reject the whole plan before
 * any of these are published. Null color preserves the native nullable argument;
 * it does not invent a Web/default fade color. */
export type SourcePresentationEffect =
  | { kind: "fade-out"; seconds: 2; color: null }
  | { kind: "goto-title" }
  | { kind: "stop-script-input" };

export type SourcePresentationPlan = {
  flow: "next" | "end";
  eventWrites: { ref: VariableRef; value: number }[];
  effects: SourcePresentationEffect[];
};

/** The owning session supplies actual lifecycle context. Field content is not
 * allowed to manufacture absence because it lacks the Unity advertisement UI.
 * Effect preparation must be reversible; commit is the single publication step. */
export type SourcePresentationPort = {
  context(): SourcePresentationContext;
  prepare?(effects: readonly SourcePresentationEffect[]): { commit(): void };
};

export function createSourcePresentationContext(
  entry: SourcePresentationEntry,
): SourcePresentationContext {
  if (entry.kind === "title-new-game") {
    checkpointKeys(entry, "kind,titleCleanupComplete,openingCallbackStarted");
    if (
      entry.titleCleanupComplete !== true ||
      entry.openingCallbackStarted !== false
    )
      throw new Error(
        "Unproved ordinary title/new-game presentation lifecycle",
      );
    return {
      kind: "source-presentation-context-v1",
      advertisementOpeningFader: "absent",
      origin: "title-new-game",
    };
  }
  if (entry.kind === "advertisement-opening") {
    checkpointKeys(entry, "kind,faderSetupComplete");
    if (entry.faderSetupComplete !== true)
      throw new Error("Unproved advertisement fader setup");
    return {
      kind: "source-presentation-context-v1",
      advertisementOpeningFader: "present",
      origin: "advertisement-opening",
    };
  }
  checkpointKeys(entry, "kind");
  if (entry.kind !== "unresolved")
    throw new Error("Unknown source presentation entry");
  return {
    kind: "source-presentation-context-v1",
    advertisementOpeningFader: "unknown",
    origin: "unresolved",
  };
}

export function cloneSourcePresentationContext(
  context: SourcePresentationContext | null,
): SourcePresentationContext | null {
  if (context === null) return null;
  checkpointKeys(context, "kind,advertisementOpeningFader,origin");
  if (
    context.kind !== "source-presentation-context-v1" ||
    !(
      (context.origin === "title-new-game" &&
        context.advertisementOpeningFader === "absent") ||
      (context.origin === "advertisement-opening" &&
        context.advertisementOpeningFader === "present") ||
      (context.origin === "unresolved" &&
        context.advertisementOpeningFader === "unknown")
    )
  )
    throw new Error("Invalid source presentation context");
  return { ...context };
}

/** Stable saves do not serialize the active title-demo input callback or its
 * coroutine. Unknown stays unknown on restoration; there is no zero/default fill. */
export function sourcePresentationCheckpoint(
  context: SourcePresentationContext | null,
): SourcePresentationContext | null {
  const cloned = cloneSourcePresentationContext(context);
  if (cloned?.advertisementOpeningFader === "present")
    throw new Error("Active advertisement presentation cannot be checkpointed");
  return cloned;
}

/** SetAdvertisementFlag (295520) only writes one when its component exists. It
 * returns Core.Next immediately and never clears an existing MapLocalVariable[7].
 * ReturnToTitleByAdvertisement (2920c0) starts the title transition and returns
 * Core.End; its two-second fade is not a two-second interpreter Wait. */
export function projectSourcePresentation(
  command: SourcePresentationCommand,
  context: SourcePresentationContext | null,
): SourcePresentationPlan {
  checkpointKeys(command, "kind");
  if (command.kind === "advertisement-probe") {
    const current = cloneSourcePresentationContext(context);
    if (!current || current.advertisementOpeningFader === "unknown")
      throw new Error("Unknown advertisement opening-fader host context");
    return {
      flow: "next",
      eventWrites:
        current.advertisementOpeningFader === "present"
          ? [{ ref: { category: "MapLocalVariable", index: 7 }, value: 1 }]
          : [],
      effects: [],
    };
  }
  if (command.kind === "advertisement-return-to-title") {
    // Native code has no fader-presence test here. The calling script chooses
    // the branch; the real title/fade/input host must still accept these effects.
    return {
      flow: "end",
      eventWrites: [],
      effects: [
        { kind: "fade-out", seconds: 2, color: null },
        { kind: "goto-title" },
        { kind: "stop-script-input" },
      ],
    };
  }
  throw new Error("Unknown source presentation command");
}

/** Publish through the shared event owner. All writes are checked on a detached
 * candidate before the effect host prepares or commits anything. The port owns
 * stale/repeated-transaction rejection and must publish its effects atomically. */
export function executeSourcePresentation(
  op: SourcePresentationOp,
  state: EventState,
  port: SourcePresentationPort | undefined,
): "next" | "end" {
  if (op.kind !== "source-presentation")
    throw new Error("Expected source presentation operation");
  if (!port) throw new Error("Source presentation host is unavailable");
  const plan = projectSourcePresentation(op.command, port.context());
  const candidate = new EventState(state.snapshot());
  for (const write of plan.eventWrites) candidate.write(write.ref, write.value);
  if (plan.effects.length) {
    if (!port.prepare)
      throw new Error("Source title/fade/input effect host is unavailable");
    const transaction = port.prepare(structuredClone(plan.effects));
    if (!transaction || typeof transaction.commit !== "function")
      throw new Error("Invalid source presentation transaction");
    transaction.commit();
  }
  for (const write of plan.eventWrites) state.write(write.ref, write.value);
  return plan.flow;
}
