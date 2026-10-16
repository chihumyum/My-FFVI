import { ActorAnimation } from './actor-animation.js';
import { canonical } from './canonical.js';
import { checkpointInteger, checkpointKeys } from './checkpoint-validation.js';
import { validateFieldActorFactory, type FieldActorFactoryCatalog } from './field-actor-factory.js';
import { createNativeFieldActorProjection, type NativeFieldActor, type NativeFieldActorData } from './field-native-actors.js';
import type { FieldPuppetHostProviders } from './field-puppet-effects.js';
import { fieldPuppetBoundTransparentTextures } from './field-puppet-effects.js';
import type { PartyActorCatalog } from './party-actors.js';
import { Transportations, type TransportationCatalog } from './transportation.js';
import { validateOwnedTransportations, type OwnedTransportation } from './transportation-state.js';
import { fieldCameraCellToWorld } from './field-camera.js';
import type { FieldCameraMapRange } from './field-camera.js';
import type { Character, FieldContent } from '../field/types.js';

/** Deliberate 2D Web bodies, distinct from the native MapObject construction and
 * the resident puppets that happen to use the same source asset. */
export const WEB_SOURCE_VEHICLE_LIFECYCLE = 'web-source-vehicle-lifecycle-v1' as const;
export type WebSourceVehicleLifecycle = typeof WEB_SOURCE_VEHICLE_LIFECYCLE;
export type FieldVehicleInstance = { id: number; type: number; assetId: number; actorId: string; record: OwnedTransportation };
const symbolTypes = new Set([2,3,4,6,7,8,9,10]);
export function isSourceVehicleSymbol(type: number): boolean { return symbolTypes.has(type); }
export function fieldVehicleActorId(id: number): string { checkpointInteger(id,1,0x7fffffff);return `web:source-transportation:${id}`; }
export function fieldVehicleLifecycleBinding(content: Pick<FieldContent,'developmentProfile'>, host: WebSourceVehicleLifecycle | undefined): WebSourceVehicleLifecycle | null {
  const declared=content.developmentProfile?.vehicleLifecycle;
  if(host!==undefined&&host!==WEB_SOURCE_VEHICLE_LIFECYCLE)throw Error('Unknown source vehicle lifecycle runtime policy');
  if(declared!==undefined&&declared!==WEB_SOURCE_VEHICLE_LIFECYCLE)throw Error('Unknown source vehicle lifecycle content policy');
  if(declared===undefined)return null;
  if(host!==declared||content.developmentProfile?.transportation!=='walking-magitek-framework-v1')throw Error('Source vehicle lifecycle requires explicit content and runtime authorization');
  return declared;
}
/** The existing record/flag owners determine existence in this Web map. No
 * cached enable or position survives beside the actual native actor. */
export function sourceVehicleInstances(catalog: TransportationCatalog, records: readonly OwnedTransportation[],
  mapId: number, read: Parameters<Transportations['availability']>[0]): FieldVehicleInstance[] {
  checkpointInteger(mapId,1,0x7fffffff);const source=new Transportations(catalog);
  validateOwnedTransportations(records,catalog.definitions.map(d=>d.id));
  const available=source.availability(read);
  return catalog.definitions.flatMap(d=>{
    if(d.type===1)return[];
    const owned=records.find(r=>r.id===d.id)!;
    if(owned.mapId!==mapId)return[];
    const enabled=available[String(d.id)];
    if(enabled===null)throw Error(`Unknown source vehicle release flag: ${d.id}`);
    if(!enabled)return[];
    if(d.assetId===0)throw Error(`Source vehicle has no actual body asset: ${d.id}`);
    return[{id:d.id,type:d.type,assetId:d.assetId,actorId:fieldVehicleActorId(d.id),record:structuredClone(owned)}];
  });
}
/** SaveMapManager.ParseEntityPosition calls actual IMapAccessor slot3 and
 * clears Z; SetData separately installs ParseEntityLayer/GetOnLayerZOrder.
 * The parking X/Y are map-local cell coordinates, without SetPos sentinel or
 * ConversionMapRangeCell subtraction. */
export function sourceVehicleParkingPose(record:OwnedTransportation,map:FieldCameraMapRange){
  const z=record.position.z;if(!Number.isFinite(z)||z!==Math.fround(z)||Math.trunc(z)<-0x80000000||Math.trunc(z)>0x7fffffff)throw Error("Source vehicle parking layer conversion is unresolved");
  const layer=({349:9,249:10,149:11,49:12}as Record<number,number>)[Math.trunc(z)];
  if(layer===undefined)throw Error("Source vehicle parking has no placed body layer");
  const xy=fieldCameraCellToWorld(map,{x:record.position.x,y:record.position.y},0);
  return{position:{x:xy.x,y:xy.y,z:Math.fround(({9:349,10:249,11:149,12:49}as Record<number,number>)[layer]!)},layer};
}
export function createSourceVehicleActor(input: { instance: FieldVehicleInstance; factory: FieldActorFactoryCatalog;
  partyCatalog: PartyActorCatalog; characters: Readonly<Record<string,Character>>; providers: FieldPuppetHostProviders;
  mapRange: FieldCameraMapRange; position: {x:number;y:number;z:number}; layer: number }): NativeFieldActor {
  const {instance:i,factory,catalog= input.partyCatalog}= {...input,catalog:input.partyCatalog};validateFieldActorFactory(factory);
  if(i.actorId!==fieldVehicleActorId(i.id)||i.record.id!==i.id)throw Error('Source vehicle instance identity changed');
  const d=catalog.transportations.filter(d=>d.id===i.id);
  if(d.length!==1||d[0]!.typeId!==i.type||d[0]!.fieldAssetId!==i.assetId)throw Error('Source vehicle actor differs from its trusted field asset catalog');
  const asset=catalog.assets[i.assetId],media=asset&&input.characters[asset.asset];
  if(!asset||!media?.source?.file||!media.source.assetPath||!Object.keys(media.sprites).length||![0,1].includes(asset.shadowType))throw Error(`Source vehicle body media is unavailable: ${i.id}`);
  checkpointKeys(input.position,'x,y,z');for(const v of Object.values(input.position))if(!Number.isFinite(v)||Math.fround(v)!==v)throw Error('Source vehicle body position is not finite float32');
  checkpointInteger(input.layer,9,12);const direction=({1:'up',2:'right',4:'down',8:'left'}as const)[i.record.direction as 1|2|4|8];
  if(!direction)throw Error(`Source vehicle body direction is unresolved: ${i.id}`);
  const animation=new ActorAnimation(media);animation.look(direction);
  const properties=input.providers.applyViewProperties?.(input.layer),map=input.providers.mapRenderContext;
  if(!properties||!map)throw Error('Source vehicle body view/texture owner is unavailable');
  const visible=isSourceVehicleSymbol(i.type),entity:NativeFieldActorData['entity']={
    id:i.actorId,character:true,position:{...input.position},layer:input.layer,direction,animation,
    visible,fadeAlpha:visible?1:0,childEntityObject:factory.npcPrefab.childEntityObject,moving:false,
    riding:false,riderAssetId:null,rideOnEntity:factory.npcPrefab.rideOnEntity,bodyOpaque:true,shadowVisible:asset.shadowType===1,
    viewBinding:{map,layer:input.layer,properties:structuredClone(properties)},transparentTextures:fieldPuppetBoundTransparentTextures(input.layer,input.providers),
  };
  return createNativeFieldActorProjection({entity,fieldAssetId:i.assetId,charaZOffset:0,sourceTransportationId:i.id},input.mapRange,catalog,'framework-development');
}

/** A short lived phase fence, not a second parking/current/actor state owner.
 * Source VM execution after a committed phase is never rolled back by it. */
export class FieldVehicleLifecycle {
  #epoch=0;#retired=false;#pending:{token:object;phase:string;epoch:number}|null=null;
  get busy(){return this.#pending!==null;}
  get retired(){return this.#retired;}
  prepare(phase:string,current:()=>string){
    if(this.#retired||this.#pending)throw Error('Source vehicle lifecycle is retired or already preparing');
    const before=current(),token={},epoch=this.#epoch;this.#pending={token,phase,epoch};let consumed=false;
    const validate=()=>{if(consumed||this.#retired||this.#epoch!==epoch||this.#pending?.token!==token||current()!==before)throw Error('Stale source vehicle lifecycle transaction');};
    return{validate,commit:(publish:()=>void)=>{validate();publish();consumed=true;this.#pending=null;this.#epoch++;},
      cancel:()=>{if(!consumed&&this.#pending?.token===token){this.#pending=null;this.#epoch++;}consumed=true;}};
  }
  retire(){if(this.#retired)return;this.#retired=true;this.#pending=null;this.#epoch++;}
}
