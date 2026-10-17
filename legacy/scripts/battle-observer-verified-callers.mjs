import {createBattleObserverCallers} from './battle-observer-callers.mjs';

/** Per experiment only. Weak keys come exclusively from the privately owned,
 * deeply frozen definition builder; never from outside caller identities. */
export function createVerifiedBattleObserverCallers(api,input){
 const owners=createBattleObserverCallers(api,input),documents=new WeakMap();
 let capturedDocuments=0,documentHits=0,preparedRows=0;
 async function capture(value){
  if(documents.has(value)){documentHits++;return documents.get(value);}
  const cap=await api.captureVerifiedContent(value);
  documents.set(value,cap);capturedDocuments++;return cap;
 }
 async function prepare(program,partyOverride){
  const d=owners.prepare(program,partyOverride),keys=['sourceEntry','sourceBattle','sourceMap','world','map','battle'],
   values=await Promise.all(keys.map(key=>capture(d[key]))),verified=Object.fromEntries(keys.map((key,i)=>[key,values[i]])),
   content=await api.compileFrameworkNewGameFromVerified({...verified,entrance:d.map.partyEntry.pointIns[0].id}),
   contentCap=await api.captureVerifiedContent(content);
  preparedRows++;return Object.freeze({...d,content,verified:Object.freeze({...verified,content:contentCap})});
 }
 return Object.freeze({prepare,stats:()=>({...owners.stats(),capturedDocuments,documentHits,preparedRows})});
}
