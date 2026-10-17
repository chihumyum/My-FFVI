import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

/** An initializer may commit another map. A shared alias (for example a
 * Resident program) on that destination cannot stand in for the nominated
 * source body. Validate synchronously immediately before public startEvent.
 * This is observer evidence only and grants no gameplay or provider ability. */
export function assertSourceProgramOrigin({field,map,script,canonical}) {
 assert.equal(typeof canonical,'function');
 const expectedMapId=map.mapId??map.map?.identity?.mapId,actualMapId=field.content.map.identity?.mapId;
 const fail=reason=>{const error=new Error(reason);error.code='SOURCE_PROGRAM_ORIGIN_MISMATCH';
  error.expectedMapId=expectedMapId;error.actualMapId=actualMapId??null;throw error;};
 if(!Number.isSafeInteger(expectedMapId)||expectedMapId<1||actualMapId!==expectedMapId)
  fail('Source initializer left the nominated map; destination aliases cannot execute its original root');
 for(const key of ['sourceSetHash','parentSourceSetHash'])
  if(typeof map[key]!=='string'||field.content[key]!==map[key])fail('Source program generation differs: '+key);
 if(typeof script!=='string'||!script||!Array.isArray(map.scripts?.[script])||!Array.isArray(field.content.scripts?.[script]))
  fail('Nominated source root is missing from the actual field namespace');
 const names=['scripts','scriptLocals','scriptSystemFlags','scriptPuppetContexts','scriptTransitionMetadata'],namespace={};
 for(const key of names){
  const expected=map[key]??null,actual=field.content[key]??null;
  if(canonical(actual)!==canonical(expected))fail('Actual source namespace or metadata differs: '+key);
  namespace[key]=actual;
 }
 return{kind:'observed-original-source-program-origin-v1',mapId:actualMapId,sourceSetHash:map.sourceSetHash,
  parentSourceSetHash:map.parentSourceSetHash,script,
  namespaceSha256:createHash('sha256').update(canonical(namespace)).digest('hex')};
}
