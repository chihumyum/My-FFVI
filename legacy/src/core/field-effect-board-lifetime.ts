import type {FieldEffectOperation} from './field-effects.js';
/** Opaque manager-local identity. It never appears in FX snapshots, operation
 * journals, providers, checkpoints or content. Authority is reference equality
 * with the current owner's sidecar, not possession of a JSON-shaped value. */
const lifetimeBrand:unique symbol=Symbol('FieldEffectBoardLifetime');
export type FieldEffectBoardLifetime=Readonly<{[lifetimeBrand]:true}>;
function fresh():FieldEffectBoardLifetime{return Object.freeze(Object.defineProperty({},lifetimeBrand,{value:true})) as FieldEffectBoardLifetime;}
export function initialFieldEffectBoardLifetimes(ids:readonly string[]):Map<string,FieldEffectBoardLifetime>{
 const map=new Map<string,FieldEffectBoardLifetime>();for(const id of ids){if(map.has(id))throw Error('Duplicate board lifetime identity');map.set(id,fresh());}return map;
}
/** Called only after the corresponding complete operation list has passed the
 * existing FX projection. Preserve ordered destroy/create with a reused ID. */
export function projectFieldEffectBoardLifetimes(previous:ReadonlyMap<string,FieldEffectBoardLifetime>,operations:readonly FieldEffectOperation[]):Map<string,FieldEffectBoardLifetime>{
 const next=new Map(previous);for(const op of operations){if(op.kind==='destroy')next.delete(op.id);else if(op.kind==='create')next.set(op.id,fresh());}return next;
}
