import { sourceScriptAnimationAsset } from "./source-script-animations.js";
import type { Evidence, FieldContent } from '../field/types.js';
import { checkpointKeys } from './checkpoint-validation.js';
import { canonical } from './canonical.js';
import { EventState } from './event-state.js';

/** These are the two literal arguments of the native battle wrappers, not a
 * global script lookup or a per-encounter exception. Resolution is always in
 * the actual current map, using its ordinary package aliases. */
export const BATTLE_RESERVED_SCRIPTS = {
  'gau-first-join': 'sc_e_0239',
  'shadow-departure': 'sc_secede_shadow',
} as const;
export type BattleReservedScript = keyof typeof BATTLE_RESERVED_SCRIPTS;
export type SourceReservedScriptBinding = {
  kind: 'source-reserved-field-script-v1'; name: string; rawHash: string;
  sourceSetHash: string; parentSourceSetHash: string; source: Evidence & {objectId:string;serializedFile:string;sha256:string};
};
export type BattleFieldReservationSnapshot = {
  kind: 'source-field-reservation-v1'; parentSourceSetHash: string;
  script: string;
};
export type RtsFieldReservationSnapshot={kind:'source-rts-field-reservation-v1';parentSourceSetHash:string;script:'sc_sht_corps_after'};
export type FieldReservationSnapshot=BattleFieldReservationSnapshot|RtsFieldReservationSnapshot;
export type BattleFieldReservation = {
  kind: 'battle-field-reservation-v1'; entry: BattleFieldReservationSnapshot | null;
  candidate: BattleFieldReservationSnapshot | null;
};
export function parseFieldReservation(raw: unknown): BattleFieldReservationSnapshot {
  checkpointKeys(raw, 'kind,parentSourceSetHash,script');
  const v = raw as BattleFieldReservationSnapshot;
  if (v.kind !== 'source-field-reservation-v1' || !/^[a-f0-9]{64}$/.test(v.parentSourceSetHash) ||
      !Object.values(BATTLE_RESERVED_SCRIPTS).includes(v.script as 'sc_e_0239'))
    throw new Error('Invalid source field reservation');
  return structuredClone(v);
}
export function parseRtsFieldReservation(raw:unknown):RtsFieldReservationSnapshot {
 checkpointKeys(raw,'kind,parentSourceSetHash,script');const v=raw as RtsFieldReservationSnapshot;
 if(v.kind!=='source-rts-field-reservation-v1'||v.script!=='sc_sht_corps_after'||!/^[a-f0-9]{64}$/.test(v.parentSourceSetHash))throw Error('Invalid source RTS field reservation');return structuredClone(v);
}
export function reservedScriptBinding(content: FieldContent, name: string): SourceReservedScriptBinding {
  const binding = content.reservedScriptBindings?.[name], program = content.scripts[name];
  if (!binding || !program?.length) throw new Error('Reserved field script has no current package binding: ' + name);
  checkpointKeys(binding, 'kind,name,rawHash,sourceSetHash,parentSourceSetHash,source');
  checkpointKeys(binding.source, 'file,assetPath,objectId,serializedFile,sha256');
  if (binding.kind !== 'source-reserved-field-script-v1' || binding.name !== name ||
      binding.sourceSetHash !== content.sourceSetHash || binding.parentSourceSetHash !== content.parentSourceSetHash ||
      !/^[a-f0-9]{64}$/.test(binding.rawHash) || !binding.source.file || !binding.source.assetPath || !binding.source.serializedFile || !/^[a-f0-9]{64}$/.test(binding.source.sha256) ||
      typeof binding.source.objectId !== 'string' || !/^-?(?:0|[1-9]\d*)$/.test(binding.source.objectId) ||
      program.some(op => op.script !== name || op.source.file !== binding.source.file ||
        op.source.assetPath !== binding.source.assetPath || op.source.objectId !== binding.source.objectId))
    throw new Error('Reserved field script source identity changed: ' + name);
  const animationAsset=sourceScriptAnimationAsset(content.scriptTransitionMetadata?.[name],content.sourceScriptAnimations);
  if(animationAsset!==null){const catalog=content.sourceScriptAnimations!,asset=catalog.assets[animationAsset]!;
    if(catalog.sourceSetHash!==content.sourceSetHash||catalog.parentSourceSetHash!==content.parentSourceSetHash||
        asset.rawScriptHash!==binding.rawHash||canonical(asset.source)!==canonical(binding.source))
      throw new Error('Reserved field script custom animation source identity changed: '+name);}
  if (
      !Object.hasOwn(content.scriptLocals ?? {}, name) || content.scriptLocals![name] === null ||
      !content.scriptSystemFlags?.[name])
    throw new Error('Reserved field script requires its original locals, flags and custom-animation provider: ' + name);
  if (content.scriptPuppetContexts?.[name] && content.scriptPuppetContexts[name]!.scriptHash !== binding.rawHash)
    throw new Error('Reserved script actor lifecycle/body digest mismatch: ' + name);
  new EventState().beginScript(content.scriptLocals![name]!);
  // Full native actor contexts are prepared by FieldGame at the actual idle
  // boundary. A binding does not grant a missing actor/media host or a blocked
  // instruction. Unknown instructions still fail at their original source PC.
  return structuredClone(binding);
}
/** Read-only capture may include an unavailable target; actual require/consume
 * validates it lazily through reservedScriptBinding at the source instruction. */
export function reservationSourceFingerprint(content: FieldContent, name: string): string {
  return canonical({ binding: content.reservedScriptBindings?.[name] ?? null, body: content.scripts[name] ?? null,
    locals: content.scriptLocals?.[name] ?? null, flags: content.scriptSystemFlags?.[name] ?? null,
    puppet: content.scriptPuppetContexts?.[name] ?? null,
    customAnimations: content.scriptTransitionMetadata?.[name] ?? null, customCatalog: content.sourceScriptAnimations?.contentHash ?? null });
}
export function reservationFingerprint(content: FieldContent, name: string): string {
  reservedScriptBinding(content,name);
  return reservationSourceFingerprint(content,name);
}
/** The session owns the native Integrator's single slot across field lifetimes.
 * A prepared/retired map can neither consume it nor allocate a second slot. */
export interface FieldReservedScriptPort {
  read(): FieldReservationSnapshot | null;
  prepareRts?(content:FieldContent):{validate():void;commit():void};
  prepareConsume(content: FieldContent): { script: string; validate(): void; commit(): void } | null;
}
export type BattleFieldReservationHost = {
  entry: BattleFieldReservationSnapshot | null;
  require(role: BattleReservedScript): BattleFieldReservationSnapshot;
};
