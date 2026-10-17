import { checkpointKeys } from "./checkpoint-validation.js";
import { canonical } from "./canonical.js";
import type { BattleEffectResourceLease } from "./battle-event-effect.js";
import type { BattleAppearanceActor } from "./battle-appearance.js";

export const WEB_BATTLE_GAU_INSTANCES = "web-source-battle-gau-instances-v1" as const;
export type WebBattleGauInstances = typeof WEB_BATTLE_GAU_INSTANCES;

/** This is a renderer/factory binding, never a player, owned record or side
 * change. The enemy keeps its original Monster parameters, source and AI. */
export type EnemyPlayerAppearance = {
  kind: "source-enemy-player-appearance-v1";
  monsterId: number;
  characterStatusId: number;
  jobId: number;
  weaponId: number;
  actor: BattleAppearanceActor | null;
  gate: string | null;
};
export type BattleGauInstanceContent = {
  kind: "source-battle-gau-instances-v1";
  firstPartyId: number;
  returnPartyId: number;
  joinedSourceId: number;
  /** Complete source animation_enemy_params order, not only Gau's two rows. */
  playerPrefabs: EnemyPlayerAppearance[];
};

const positive = (value: unknown) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 0x7fffffff)
    throw new Error("Invalid source enemy-player factory identity");
  return value;
};
export function parseEnemyPlayerAppearance(raw: unknown): EnemyPlayerAppearance {
  checkpointKeys(raw, "kind,monsterId,characterStatusId,jobId,weaponId,actor,gate");
  const value = raw as EnemyPlayerAppearance;
  if (value.kind !== "source-enemy-player-appearance-v1") throw new Error("Unknown enemy player appearance binding");
  positive(value.monsterId); positive(value.characterStatusId); positive(value.jobId); positive(value.weaponId);
  if(value.actor===null){if(typeof value.gate!=="string"||!value.gate)throw new Error("Missing explicit source factory media gate");return structuredClone(value);}
  if(value.gate!==null)throw new Error("Bound source factory actor cannot hide a media gate");
  checkpointKeys(value.actor, "sourceId,characterAssetId,sizeType,bodySprites,bodyGeometry");
  if (value.actor.sourceId !== value.characterStatusId)
    throw new Error("Enemy player appearance differs from the actual visual character");
  positive(value.actor.characterAssetId); positive(value.actor.sizeType);
  if (!value.actor.bodySprites || !value.actor.bodyGeometry || Array.isArray(value.actor.bodySprites) ||
      Array.isArray(value.actor.bodyGeometry) || !Object.keys(value.actor.bodySprites).length ||
      canonical(Object.keys(value.actor.bodySprites).sort()) !== canonical(Object.keys(value.actor.bodyGeometry).sort()))
    throw new Error("Missing complete enemy player appearance media binding");
  return structuredClone(value);
}
export function parseBattleGauInstanceContent(raw: unknown): BattleGauInstanceContent {
  checkpointKeys(raw, "kind,firstPartyId,returnPartyId,joinedSourceId,playerPrefabs");
  const value = raw as BattleGauInstanceContent;
  if (value.kind !== "source-battle-gau-instances-v1") throw new Error("Unknown source Gau instance protocol");
  positive(value.firstPartyId); positive(value.returnPartyId); positive(value.joinedSourceId);
  if (value.firstPartyId === value.returnPartyId || !Array.isArray(value.playerPrefabs) || !value.playerPrefabs.length)
    throw new Error("Missing source Gau instance branches or complete prefab mapping");
  const playerPrefabs = value.playerPrefabs.map(parseEnemyPlayerAppearance);
  if (new Set(playerPrefabs.map(row => row.monsterId)).size !== playerPrefabs.length)
    throw new Error("Ambiguous source enemy player prefab mapping");
  return { ...value, playerPrefabs };
}
export function validateBattleGauInstancePolicy(policy: unknown): void {
  if (policy !== undefined && policy !== WEB_BATTLE_GAU_INSTANCES)
    throw new Error("Unknown source Gau instance Web policy");
}

/** A live lease's private candidate is owned by GameState. This port cannot
 * publish persistent state, manufacture a held record, or use fieldRoster. */
export type BattleGauOwnedFrame = {
  join(input: { sourceId: number; firstEncounter: boolean }): { ownedId: string; sourceId: number };
  validate(): void;
  prepareCommit(): { validate(): void; commit(): void };
  discard(): void;
};
export type BattleGauOwnedHost = {
  policy: WebBattleGauInstances;
  prepareFrame(): BattleGauOwnedFrame;
  /** Retiring a battle invalidates late work. A new explicit retry attempt may
   * then start from the lease's original, still unpublished owned entry. */
  retire(): void;
};

export const gauAppearancePoses = ["handsUpB00", "winR00", "handsUp00", "WalkL01"] as const;
/** Times are the actual native float32 constants. The host evaluates them on
 * its existing fixed battle clock and acknowledges its real resource ticket. */
export const gauAppearanceTimes = [0, Math.fround(.15), Math.fround(.30), Math.fround(.45)] as const;
export const gauAppearanceDuration = Math.fround(.60);

/** These native constants select complete source parties, not encounter/PC
 * exceptions. The compiler binds both original rows and all children. */
export const gauSourceParties = [522, 523] as const;
export const gauJoinedCharacterSource = 12;
export function parseWebBattleGauInstances(raw: unknown): WebBattleGauInstances {
  if (raw !== WEB_BATTLE_GAU_INSTANCES) throw new Error("Missing or unknown source Gau instance Web policy");
  return raw;
}
export type BattleGauMediaRequest = {
  kind: "source-gau-instance-media-v1";
  operation: "replace" | "appearance";
  sprites: { id: string; file: string; width: number; height: number }[];
};
export type BattleGauMediaHost = {
  policy: WebBattleGauInstances;
  prepare(request: BattleGauMediaRequest): BattleEffectResourceLease;
};
export type BattleGauInstanceHost = BattleGauMediaHost & { owned: BattleGauOwnedHost };
/** The actual image repository supplies readiness and dimensions. Neither the
 * policy marker nor an absent image is an implicit ready acknowledgement. */
export function createBattleGauMediaHost(read: (sprite: BattleGauMediaRequest["sprites"][number]) =>
  { complete: boolean; width: number; height: number } | null): BattleGauMediaHost {
  if (typeof read !== "function") throw new Error("Missing actual Gau media repository");
  return { policy: WEB_BATTLE_GAU_INSTANCES, prepare(raw) {
    const request = structuredClone(raw);
    checkpointKeys(request,"kind,operation,sprites");
    if(request.kind!=="source-gau-instance-media-v1"||!["replace","appearance"].includes(request.operation)||!request.sprites.length)
      throw new Error("Missing source Gau media request");
    for(const sprite of request.sprites){checkpointKeys(sprite,"id,file,width,height");positive(sprite.width);positive(sprite.height);
      if(typeof sprite.id!=="string"||!sprite.id||typeof sprite.file!=="string"||!sprite.file)throw new Error("Missing source Gau sprite identity");}
    let retired=false;
    const status=()=>{if(retired)return "failed" as const;let waiting=false;
      for(const sprite of request.sprites){const value=read(structuredClone(sprite));
        if(value===null||value.complete===false){waiting=true;continue;}
        if(value.complete!==true||value.width!==sprite.width||value.height!==sprite.height)return "failed" as const;}
      return waiting?"loading" as const:"ready" as const;};
    const validate=()=>{if(retired||status()==="failed")throw new Error("Retired or invalid Gau media lease");};
    return {status,validate,commit(){validate();},discard(){retired=true;}};
  }};
}
