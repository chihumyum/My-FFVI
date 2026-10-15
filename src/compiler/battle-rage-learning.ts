import { z } from 'zod';
import { hash } from './content.js';

const pair = z.tuple([z.number().int().positive().max(0x7fffffff), z.number().int().positive().max(0x7fffffff)]);
/** Data compilation is deliberately independent of learning permission. A
 * Rage lookup cannot create an owned character, command, condition614, ATB
 * retirement callback or grant any ability by itself. */
export function compileRageLearningRows(rawPairs: unknown, abilityRows: readonly Record<string,string>[]) {
  const pairs=z.array(pair).parse(rawPairs);
  if(new Set(pairs.map(p=>p[0])).size!==pairs.length)throw new Error('Duplicate native Rage monster mapping');
  const entries=pairs.map(([monsterId,abilityId])=>{
    const matches=abilityRows.filter(row=>row.id===String(abilityId));
    if(matches.length!==1)throw new Error('Missing/ambiguous Rage ability master: '+abilityId);
    return {monsterId,abilityId,abilityRow:{...matches[0]!}};
  });
  return {kind:'source-rage-learning-data-v1' as const,entries,grantsOwnedAbilities:false as const};
}
export function compileSourceRageLearning(raw:unknown,abilityRows:readonly Record<string,string>[],sourceSetHash:string) {
  const digest=z.string().regex(/^[a-f0-9]{64}$/),range=(rva:number,bytes:number,sha256:string)=>z.object({rva:z.literal(rva),bytes:z.literal(bytes),sha256:z.literal(sha256)}).strict();
  const proof=z.object({kind:z.literal('source-native-rage-map-v1'),nativeSha256:z.literal('1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'),
    construction:range(0x2abcea,33,'2887292293db18b7bad8f2d84fd190186a3bb7c273124695afae82853265ba23'),
    range:range(0x2abd0b,6580,'78d1fc8de4845e53173045b7f31988928414236fcd8be73d2f5cddcca9c2e5a2'),
    setter:range(0x50170,16,'24871d5524e1a7ce07034ab66a0805437f71e87fa75818982b933ef27b1f8482'),
    pairsSha256:z.literal('36a9a7abc572f08410fd0f1588c55af0a16039ca5cdcbc89b93cfe5d559674c7'),
    pairs:z.array(pair).length(252),addCallRvas:z.array(z.string().regex(/^0x[0-9a-f]+$/)).length(252),nativeExecuted:z.literal(false),dynamicParity:z.literal(false)}).strict().parse(raw);
  if(hash(proof.pairs)!==proof.pairsSha256||new Set(proof.addCallRvas).size!==252)throw new Error('Native Rage mapping proof differs from the exact extracted literals');
  const data={...compileRageLearningRows(proof.pairs,abilityRows),sourceSetHash:digest.parse(sourceSetHash),
    nativeEvidence:{nativeSha256:proof.nativeSha256,construction:proof.construction,range:proof.range,setter:proof.setter,pairsSha256:proof.pairsSha256}};
  return {...data,contentHash:hash(data)};
}
