import { canonical } from "./canonical.js";
import { validateFieldActorFactory, type FieldActorFactoryBindings, type FieldActorFactoryCatalog } from "./field-actor-factory.js";
import type { NativeFieldActorOwner } from "./field-native-actors.js";
import type { FieldPuppetHostActor } from "./field-puppet-effects.js";

export const WEB_FLAT_CONDITION_LEADER_ACTIVITY = "web-flat-condition-leader-activity-v1" as const;
export type FieldConditionActivityScopeHost = {
  readActors(): NativeFieldActorOwner;
  readBindings(): FieldActorFactoryBindings;
  readFactory(): FieldActorFactoryCatalog;
};
export type FieldConditionActivityScope = {
  isActiveAndEnabled(actorId: string, draft: Readonly<FieldPuppetHostActor>): boolean | "unknown";
  validate(): void;
};
export type FieldConditionActivityPort = {
  readonly policy: typeof WEB_FLAT_CONDITION_LEADER_ACTIVITY;
  prepare(host: FieldConditionActivityScopeHost): FieldConditionActivityScope;
};

const sourceFactory = [
  { file: "GameAssembly.dll", sha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc" },
  { file: "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle",
    sha256: "82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa" },
];
function ordinary(entity: Readonly<FieldPuppetHostActor>): boolean {
  return entity.character === true && entity.childEntityObject === "absent" && typeof entity.visible === "boolean" &&
    typeof entity.riding === "boolean" && ["absent", "idle", "riding"].includes(entity.rideOnEntity) &&
    entity.riding === (entity.rideOnEntity === "riding");
}

/** Deliberate Web policy, not a recovered arbitrary native hierarchy rule.
 * The flat Web actor host has no component-enable or ancestor-active owner:
 * both are fixed true in this explicitly selected representation. activeSelf
 * still belongs to the actual actor/draft entity. A save, actor.visible, or a
 * source script flag cannot create this runtime capability or its whitelist.
 * Fresh prefab evidence supports the factory binding, not universal ancestry.
 */
export function createWebFlatConditionLeaderActivityPort(): FieldConditionActivityPort {
  return Object.freeze({ policy: WEB_FLAT_CONDITION_LEADER_ACTIVITY,
    prepare(host: FieldConditionActivityScopeHost): FieldConditionActivityScope {
      const owner = host.readActors(), bindings = host.readBindings(), factory = host.readFactory();
      validateFieldActorFactory(factory);
      if (canonical(factory.sources) !== canonical(sourceFactory))
        throw new Error("Unreviewed Web flat condition activity factory source");
      if (!Array.isArray(bindings.partyPuppets) || bindings.partyPuppets.length !== 4 ||
          !Array.isArray(bindings.otherParties) || bindings.otherParties.length !== 3 || !Array.isArray(bindings.residents))
        throw new Error("Missing Web flat condition activity factory bindings");
      const ids = [bindings.player, ...bindings.partyPuppets, ...bindings.otherParties, ...bindings.residents.map(row => row.actor)];
      if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length)
        throw new Error("Ambiguous Web flat condition activity factory identity");
      const refs = ids.map(id => {
        const actor = owner[id], native = actor?.native, entity = native?.entity;
        if (!actor || actor.id !== id || !native || !entity || entity.id !== id || !ordinary(entity))
          throw new Error("Unbound Web flat condition activity native actor");
        return { id, actor, native, entity };
      });
      const bound = new Map(refs.map(ref => [ref.id, ref]));
      const fingerprint = canonical({ bindings, factory });
      const validate = () => {
        if (host.readActors() !== owner || host.readBindings() !== bindings || host.readFactory() !== factory ||
            canonical({ bindings, factory }) !== fingerprint || refs.some(ref => owner[ref.id] !== ref.actor ||
              ref.actor.native !== ref.native || ref.native.entity !== ref.entity || ref.entity.id !== ref.id))
          throw new Error("Stale Web flat condition activity scope");
      };
      return Object.freeze({ validate,
        isActiveAndEnabled(id: string, draft: Readonly<FieldPuppetHostActor>): boolean | "unknown" {
          validate();
          if (!bound.has(id) || !draft || draft.id !== id || !ordinary(draft)) return "unknown";
          return draft.visible;
        } });
    } });
}
