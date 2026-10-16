import {canonical}from'./canonical.js';
import {createNativeFieldActorDraft,readNativeFieldActors,prepareNativeFieldActorState}from'./field-native-actors.js';
import {projectFieldPuppetActorEffects}from'./field-puppet-effects.js';
import {multiCorpsPlacement,type MultiCorpsCommand}from'./field-multi-corps.js';
import type {RtsNativeActorHost}from'./field-rts-actors.js';
import type {MapPartyEntryDefinition}from'./map-party-entry.js';

/** PlacementPartyEntity mutates the existing three factory instances. No
 * refresh, player move, selected-bank switch or camera change is invented. */
export function prepareMultiCorpsPlacementActors(h:RtsNativeActorHost,command:MultiCorpsCommand,definition:MapPartyEntryDefinition|undefined){
 const source=canonical(definition??null),bindings=h.bindings;
 if(bindings.otherParties.length!==3)throw Error('Source deployment requires all actual Corps actors');
 const project=()=>{
  const {preset,positions}=multiCorpsPlacement(command,definition,h.map),actors=Object.fromEntries(Object.values(h.readActors()).map(a=>[a.id,createNativeFieldActorDraft(a,h.map,h.catalog,h.transportationPresentation)]));
  for(const pose of positions){const id=bindings.otherParties[pose.slot]!,actor=actors[id];
   if(!actor||actor.motion||actor.native.entity.moving||actor.native.entity.childEntityObject!=='absent'||actor.native.entity.riding||!['absent','idle'].includes(actor.native.entity.rideOnEntity))throw Error('Source deployment actor lifecycle is absent, moving or unresolved');
   actor.native.entity.position={...pose.position};actor.native.entity.layer=pose.layer;actor.native.entity.direction=pose.direction;
   // Chara.Init -> LookAt(changeAnimDefault=true); zero vector selects the
   // source Default key while retaining zero direction, never a down turn.
   actor.animation?.look('down');
   const effects=[{kind:'apply-view-properties' as const,actor:id},
    {kind:actor.native.fieldAssetId===null?'hide' as const:'show' as const,actor:id},
    ...(actor.native.fieldAssetId===null?[]:[{kind:'attach-transparent' as const,actor:id}])];
   const value=projectFieldPuppetActorEffects(effects,readNativeFieldActors(actors,null),h.readProviders());
   for(const entity of value.actors){const{moving:_,...data}=entity;Object.assign(actors[entity.id]!.native.entity,data);}
  }
  const hidden=bindings.otherParties[0]!;
  const value=projectFieldPuppetActorEffects([{kind:'hide',actor:hidden}],readNativeFieldActors(actors,null),h.readProviders());
  for(const entity of value.actors){const{moving:_,...data}=entity;Object.assign(actors[entity.id]!.native.entity,data);}
  if(preset.cue){const second=actors[bindings.otherParties[1]!]!;if(!second.animation)throw Error('Source deployment Dying animation host is unavailable');second.animation.cue(preset.cue,-1);second.animation.frame();}
  return actors;
 };
 const fingerprint=(a:ReturnType<typeof project>)=>canonical(Object.values(a).map(a=>({...a.native,entity:{...a.native.entity,animation:a.animation&&{state:a.animation.snapshot(),character:a.animation.character}}}))),
  next=project(),expected=fingerprint(next),prepared=prepareNativeFieldActorState({readActors:h.readActors,readCamera:()=>null,readProviders:h.readProviders},next);
 let consumed=false;
 const validate=()=>{if(consumed||canonical(definition??null)!==source)throw Error('Stale source deployment content');prepared.validate();if(fingerprint(project())!==expected)throw Error('Source deployment actor/media/provider changed');prepared.validate();};
 return{validate,commit:(beforeWrite:()=>void)=>{validate();beforeWrite();prepared.commit();consumed=true;}};
}
