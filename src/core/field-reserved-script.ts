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
export type FieldReservationSnapshot = {
  kind: 'source-field-reservation-v1'; parentSourceSetHash: string;
  script: string;
};
export type BattleFieldReservation = {
  kind: 'battle-field-reservation-v1'; entry: FieldReservationSnapshot | null;
  candidate: FieldReservationSnapshot | null;
};
export function parseFieldReservation(raw: unknown): FieldReservationSnapshot {
  checkpointKeys(raw, 'kind,parentSourceSetHash,script');
  const v = raw as FieldReservationSnapshot;
  if (v.kind !== 'source-field-reservation-v1' || !/^[a-f0-9]{64}$/.test(v.parentSourceSetHash) ||
      !Object.values(BATTLE_RESERVED_SCRIPTS).includes(v.script as 'sc_e_0239'))
    throw new Error('Invalid source field reservation');
  return structuredClone(v);
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
  if (content.scriptTransitionMetadata?.[name]?.customAnimations !== 'none' ||
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
export function reservationFingerprint(content: FieldContent, name: string): string {
  return canonical({ binding: reservedScriptBinding(content, name), body: content.scripts[name],
    locals: content.scriptLocals?.[name], flags: content.scriptSystemFlags?.[name],
    puppet: content.scriptPuppetContexts?.[name] ?? null });
}
/** The session owns the native Integrator's single slot across field lifetimes.
 * A prepared/retired map can neither consume it nor allocate a second slot. */
export interface FieldReservedScriptPort {
  read(): FieldReservationSnapshot | null;
  prepareConsume(content: FieldContent): { script: string; validate(): void; commit(): void } | null;
}
export type BattleFieldReservationHost = {
  entry: FieldReservationSnapshot | null;
  require(role: BattleReservedScript): FieldReservationSnapshot;
};
