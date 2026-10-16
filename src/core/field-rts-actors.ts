import {canonical}from'./canonical.js';
import {FieldPartyActors}from'./field-party-actors.js';
import {prepareNativeFieldActorAppearance,type FieldNativeAnimationKeys}from'./field-native-appearance.js';
import {createNativeFieldActorDraft,readNativeFieldActors,prepareNativeFieldActorState,type NativeFieldActor,type NativeFieldActorOwner}from'./field-native-actors.js';
import {projectFieldPuppetActorEffects,type FieldPuppetHostProviders,type FieldPuppetHostSnapshot}from'./field-puppet-effects.js';
import {fieldPuppetContextFromActors,type FieldActorFactoryBindings}from'./field-actor-factory.js';
import {fieldPuppetLeaderId,resolveFieldPuppetActor,type FieldPuppetActorCatalog,type FieldPuppetActorEffect}from'./field-puppet-actors.js';
import {rtsCapturedCoordinate,type RtsOwnedTransaction}from'./field-rts-party.js';
import type {FieldCameraHost}from'./field-camera-host.js';
import type {FieldCameraMapRange}from'./field-camera.js';
import type {PartyActorCatalog}from'./party-actors.js';
import type {FieldTransportActorPresentation}from'./field-transport-actors.js';
import type {Character,Point}from'../field/types.js';

export type RtsNativeActorHost={
 readActors():NativeFieldActorOwner & Readonly<Record<string,{readonly steps:number}>>;
 readProviders():FieldPuppetHostProviders;
 readCharacters():Readonly<Record<string,Character>>;
 readAnimationKeys():FieldNativeAnimationKeys;
 catalog:PartyActorCatalog;puppetCatalog:FieldPuppetActorCatalog;bindings:FieldActorFactoryBindings;
 partyActors:FieldPartyActors;camera:FieldCameraHost;cameraId:string;map:FieldCameraMapRange;
 transportationId:number|null;transportationPresentation?:FieldTransportActorPresentation;
 readViewType():0|1|2;readOffset():Readonly<Point>;
};
export type RtsNativeMode='shift-encounter'|'restore-encounter'|'switch'|'park';
const copy=(actor:string,from:string):FieldPuppetActorEffect[]=>[
 {kind:'copy-position',actor,from,mode:'overwrite'},{kind:'copy-layer',actor,from},
 {kind:'look',actor,from},{kind:'cue',actor,from}];
/** Detached projection onto actual factory instances and the existing camera.
 * The owned slot and event variables are committed by the containing Field
 * transaction only after this entire draft has been validated. */
export function prepareRtsNativeActors(h:RtsNativeActorHost,owned:RtsOwnedTransaction,
 mode:RtsNativeMode,originSlot:number,encounterTarget:number,parkOrigin=false){
 const bindings=h.bindings,currentParty=h.partyActors.checkpoint(),currentCamera=h.camera.snapshot(),currentOffset=h.readOffset(),
   catalog=owned.catalog,after=owned.after;
 if(bindings.partyPuppets.length!==4||bindings.otherParties.length!==3||originSlot<0||originSlot>2||
   !Number.isInteger(originSlot)||!Number.isInteger(encounterTarget)||encounterTarget< -1||encounterTarget>2)
   throw Error('Unbound source RTS native group identities');
 const project=()=>{
  const actors=Object.fromEntries(Object.values(h.readActors()).map(actor=>{
   const copy=createNativeFieldActorDraft(actor,h.map,h.catalog,h.transportationPresentation);return[copy.id,copy];
  })) as Record<string,NativeFieldActor>;
  const player=actors[bindings.player],original=actors[bindings.otherParties[originSlot]!];
  if(!player||!original||player.motion||original.motion||player.native.entity.moving||original.native.entity.moving)
    throw Error('Source RTS actual player or original-bank actor is absent or moving');
  const camera=structuredClone(currentCamera);let offset=currentOffset;
  const readCamera=()=>({id:h.cameraId,position:camera.dummy.position,layer:camera.dummy.layer});
  const draftParty=new FieldPartyActors(h.catalog,currentParty,h.transportationId,h.transportationPresentation,undefined,h.readViewType);
  const effects=(ops:FieldPuppetActorEffect[])=>{
   const next=projectFieldPuppetActorEffects(ops,readNativeFieldActors(actors,readCamera()),h.readProviders());
   for(const entity of next.actors){const{moving:_,...values}=entity;Object.assign(actors[entity.id]!.native.entity,values);}
  };
  const selectLeader=()=>{const value=draftParty.checkpoint();value.context.leaderIndex=value.context.multiParty[after.selectedSlot]!.leaderIndex;
   const p=draftParty.prepareState(value);p.validate();p.commit();};
  const refresh=()=>draftParty.prepare(after.appearance,{prepareBatch:steps=>{
   let nextOffset=offset;for(const step of steps)if(step.plan.cameraOffset!==null){
    const v=step.plan.cameraOffset;if(!Number.isFinite(Math.fround(v.x))||!Number.isFinite(Math.fround(v.y)))throw Error('Invalid source RTS camera offset');
    nextOffset=Object.freeze({x:Math.fround(v.x),y:Math.fround(v.y)});
   }
   const p=prepareNativeFieldActorAppearance({readActors:()=>actors,readCatalog:()=>h.catalog,readCharacters:h.readCharacters,
    readProviders:h.readProviders,readAnimationKeys:h.readAnimationKeys,...(h.transportationPresentation?{transportationPresentation:h.transportationPresentation}:{})},steps);
   return{validate:p.validate,commit:()=>{p.commit();offset=nextOffset;}};
  }},true)();
  let captured:[number,number,number,number]|null=null;
  if(parkOrigin||mode==='park'){
   const context=fieldPuppetContextFromActors({catalog:h.puppetCatalog,checkpoint:draftParty.checkpoint(),bindings,
    snapshot:readNativeFieldActors(actors,readCamera()),...owned.before.puppetRoster,entities:[],restorePartyInstruction:'absent'});
   const leader=resolveFieldPuppetActor(h.puppetCatalog,context,fieldPuppetLeaderId(h.puppetCatalog,context)).actor;
   if(!leader)throw Error('Source RTS departure leader is absent');
   effects(copy(original.id,leader));effects([{kind:'show',actor:original.id},{kind:'apply-view-properties',actor:original.id},{kind:'attach-transparent',actor:original.id}]);
  }
  if(mode==='shift-encounter'){
   const target=actors[bindings.otherParties[encounterTarget]!];if(!target||target.motion||target.native.entity.moving)
    throw Error('Source RTS encounter target is absent or moving');
   captured=[rtsCapturedCoordinate(player.native.entity.position.x),rtsCapturedCoordinate(player.native.entity.position.y),
    rtsCapturedCoordinate(target.native.entity.position.x),rtsCapturedCoordinate(target.native.entity.position.y)];
   // Native ShiftEncount does not call IMap43. Never replace the playable
   // sprite merely because the borrowed battle party uses a different Corps.
   selectLeader();effects(copy(original.id,player.id));
   camera.dummy.position={x:Math.fround(captured[0]),y:Math.fround(captured[1]),z:camera.dummy.position.z};
  }else if(mode==='restore-encounter'){
   for(const id of bindings.partyPuppets){if(encounterTarget!==-1)effects(copy(id,original.id));effects([{kind:'hide',actor:id}]);}
   selectLeader();refresh();
   if(encounterTarget!==-1){effects(copy(player.id,original.id));camera.dummy.position={...player.native.entity.position};camera.dummy.layer=player.native.entity.layer;}
   effects([{kind:'show',actor:player.id}]);
  }else if(mode==='switch'){
   selectLeader();refresh();
   const context=fieldPuppetContextFromActors({catalog:h.puppetCatalog,checkpoint:draftParty.checkpoint(),bindings,
    snapshot:readNativeFieldActors(actors,readCamera()),...after.puppetRoster,entities:[],restorePartyInstruction:'absent'});
   const leader=resolveFieldPuppetActor(h.puppetCatalog,context,fieldPuppetLeaderId(h.puppetCatalog,context)).actor,
     target=actors[bindings.otherParties[after.selectedSlot]!];
   if(!leader||!target||target.motion||target.native.entity.moving)throw Error('Source RTS new leader or destination-bank actor is absent or moving');
   effects(copy(leader,target.id));camera.dummy.position={...target.native.entity.position};
   effects([{kind:'show',actor:leader},{kind:'hide',actor:target.id},{kind:'apply-view-properties',actor:leader},{kind:'attach-transparent',actor:leader}]);
  }
  const party=draftParty.checkpoint();return{actors,party,camera,offset,captured,
   fingerprint:canonical({party,camera,offset,captured,actors:Object.values(actors).map(a=>({...a.native,
    entity:{...a.native.entity,animation:a.animation&&{state:a.animation.snapshot(),character:a.animation.character}}}))})};
 };
 const next=project(),actors=prepareNativeFieldActorState({readActors:h.readActors,readCamera:()=>null,readProviders:h.readProviders},next.actors),
   party=h.partyActors.prepareState(next.party),camera=h.camera.prepareState(next.camera);let consumed=false;
 const validateNative=()=>{
  if(consumed||h.readOffset()!==currentOffset||canonical(h.partyActors.checkpoint())!==canonical(currentParty))throw Error('Stale source RTS actor owner');
  actors.validate();party.validate();camera.validate();
  if(project().fingerprint!==next.fingerprint)throw Error('Source RTS media/provider changed during preparation');
  actors.validate();party.validate();camera.validate();
 };
 const validate=()=>{owned.validate();validateNative();owned.validate();};
 return{captured:next.captured,offset:next.offset,camera:structuredClone(next.camera),validate,
  commit:(beforeWrite:()=>void)=>{
   // Every fallible provider read precedes the final joint owner's check.
   validateNative();camera.commitWith(()=>{beforeWrite();consumed=true;actors.commit();party.commit();return true;});
  }};
}
