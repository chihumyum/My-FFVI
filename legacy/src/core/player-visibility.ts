import { checkpointKeys } from "./checkpoint-validation.js";

export type PlayerVisibilityCommand = {
  kind: "hide-player" | "show-player";
};

export type PlayerVisibilityOp = {
  kind: "player-visibility";
  command: PlayerVisibilityCommand;
};

/** Compiler-bound static factory admission, included in content identity rather
 * than mutable saves. Only the source prefab's fresh actual player and supported
 * lifecycles inherit it; replacing/rebinding ChildEntityObject needs a new host. */
export type PlayerVisibilityFactory = {
  factory: "native-field-player-v1";
  capability: { childEntityObject: "absent" };
  sources: { file: string; sha256: string }[];
};

/** The host binds FieldController.player, not GetFieldEntity's negative script
 * identities. Null partyPlayerId means no party appearance host is installed;
 * an installed host must identify exactly the same existing player instance.
 * ChildEntityObject is distinct from the character's rideOnEntity renderer. */
export type PlayerVisibilityBinding = {
  playerId: string;
  partyPlayerId: string | null;
  childEntityObject: "absent" | "unresolved";
};

/** A detached publication candidate, never a second persistent visibility owner.
 * The host publishes hiddenEntities through its existing field owner. Immediate
 * Show/Hide overwrites the alpha and fade status; it is not a saved-value toggle.
 * Parent, body/head, riding renderer and attached hierarchy share activation. */
export type PlayerVisibilityPlan = {
  playerId: string;
  visible: boolean;
  fadeAlpha: 0 | 1;
  currentFadeStatus: 0;
  hiddenEntities: Set<string>;
  flow: "next";
};

function identity(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("Missing player visibility instance identity");
}

/** External.Entity.HidePlayer/ShowPlayer -> IEntityAccessor.GetPlayerEntity ->
 * FieldSpriteEntity.Hide/Show(0). This does not select a party member, resolve a
 * script actor, change geometry/collision configuration, stop movement or reset
 * visibility on map entry. Unsupported child propagation rejects before writes. */
export function projectPlayerVisibility(
  command: PlayerVisibilityCommand,
  binding: PlayerVisibilityBinding,
  hiddenEntities: ReadonlySet<string>,
): PlayerVisibilityPlan {
  checkpointKeys(command, "kind");
  if (command.kind !== "hide-player" && command.kind !== "show-player")
    throw new Error("Unknown player visibility command");
  checkpointKeys(binding, "playerId,partyPlayerId,childEntityObject");
  identity(binding.playerId);
  if (binding.partyPlayerId !== null) {
    identity(binding.partyPlayerId);
    if (binding.playerId !== binding.partyPlayerId)
      throw new Error("Player visibility and party actor instances disagree");
  }
  if (binding.childEntityObject !== "absent")
    throw new Error("Player visibility child-entity propagation is unresolved");
  if (!(hiddenEntities instanceof Set))
    throw new Error("Missing field visibility owner");
  for (const id of hiddenEntities) identity(id);
  const candidate = new Set(hiddenEntities);
  const visible = command.kind === "show-player";
  if (visible) candidate.delete(binding.playerId);
  else candidate.add(binding.playerId);
  return {
    playerId: binding.playerId,
    visible,
    fadeAlpha: visible ? 1 : 0,
    currentFadeStatus: 0,
    hiddenEntities: candidate,
    flow: "next",
  };
}
