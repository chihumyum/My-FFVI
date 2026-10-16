import { canonical } from './canonical.js';
import { checkpointInteger, checkpointKeys } from './checkpoint-validation.js';
import type { Evidence } from '../field/types.js';
import type { PartyAppearanceCandidate, PartySlotIndex } from './party.js';
import type { FieldPuppetActorContext } from './field-puppet-actors.js';

/** Independent from the transportation development profile/version. */
export const WEB_RTS_PARTY_SWITCH = 'web-source-rts-party-switch-v1' as const;
export type WebRtsPartySwitch = typeof WEB_RTS_PARTY_SWITCH;
export type SourceRtsPartyCatalog = {
  kind: 'source-rts-party-v1'; policy: WebRtsPartySwitch; nativeSha256: string;miscHash:string;
  stayMapIndices: [11,12,13]; memberLimit: 4; afterScript: 'sc_sht_corps_after';
  talk: { scriptId: number; script: string; source: Evidence };
  maps: { id: number; mapName: string; source: Evidence }[];
};
export type RtsPartyCommand = 'shift-encounter'|'restore-encounter'|'talk'|'switch'|'switch-after-map'|'map-script';
export type RtsPartyOp = {kind:'rts-party';command:RtsPartyCommand};
export type RtsOwnedView = {
  selectedSlot: PartySlotIndex; appearance: PartyAppearanceCandidate;
  puppetRoster: Pick<FieldPuppetActorContext,'party'|'owned'>;
};
export type RtsOwnedTransaction = {
  readonly catalog: SourceRtsPartyCatalog; readonly before: RtsOwnedView; readonly after: RtsOwnedView;
  validate(): void; commitWith(publish:(validateOwned:()=>void)=>void):void;
};
export interface FieldRtsPartyPort {
  available():boolean;
  read(): {catalog:SourceRtsPartyCatalog;view:RtsOwnedView};
  prepare(slot:PartySlotIndex):RtsOwnedTransaction;
}
export function validateRtsPolicy(policy:unknown):asserts policy is WebRtsPartySwitch|undefined {
  if(policy!==undefined&&policy!==WEB_RTS_PARTY_SWITCH)throw Error('Unknown source RTS party policy');
}
export function validateRtsCatalog(c:SourceRtsPartyCatalog):void {
  checkpointKeys(c,'kind,policy,nativeSha256,miscHash,stayMapIndices,memberLimit,afterScript,talk,maps');
  if(c.kind!=='source-rts-party-v1'||c.policy!==WEB_RTS_PARTY_SWITCH||
     c.nativeSha256!=='1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc'||
     !/^[a-f0-9]{64}$/.test(c.miscHash)||c.memberLimit!==4||canonical(c.stayMapIndices)!==canonical([11,12,13])||c.afterScript!=='sc_sht_corps_after')
    throw Error('Unbound source RTS native provider');
  checkpointKeys(c.talk,'scriptId,script,source');checkpointInteger(c.talk.scriptId,1,0x7fffffff);
  if(typeof c.talk.script!=='string'||!c.talk.script||!c.talk.source?.file||!c.talk.source.assetPath)
    throw Error('Unknown source RTS talk binding');
  if(!Array.isArray(c.maps)||!c.maps.length)throw Error('Missing source RTS map provider');
  const ids=new Set<number>();
  for(const row of c.maps){checkpointKeys(row,'id,mapName,source');checkpointInteger(row.id,1,0x7fffffff);
    if(ids.has(row.id)||typeof row.mapName!=='string'||!row.mapName||!row.source?.file||!row.source.assetPath)
      throw Error('Missing or ambiguous source RTS map row');ids.add(row.id);}
}
export function rtsNextSlot(current:number,count:number):PartySlotIndex {
  checkpointInteger(current,0,2);checkpointInteger(count,1,3);
  if(current>=count)throw Error('Source RTS current group exceeds its declared count');
  return current+1===count?0:(current+1) as PartySlotIndex;
}
export function rtsMapScript(c:SourceRtsPartyCatalog,mapId:number):string {
  validateRtsCatalog(c);checkpointInteger(mapId,1,0x7fffffff);
  const rows=c.maps.filter(r=>r.id===mapId);if(rows.length!==1)throw Error('Source RTS stay map is unknown or ambiguous');
  return 'sc_'+rows[0]!.mapName.toLowerCase();
}
/** Native truncates captured float32 transform coordinates into Core ints.
 * Only presentation easing differs under the explicit Web policy. */
export function rtsCapturedCoordinate(value:number):number {
  const x=Math.trunc(Math.fround(value));checkpointInteger(x,-0x80000000,0x7fffffff);return x;
}
export function rtsLinearRatio(now:number,startedAt:number):number {
  if(!Number.isFinite(now)||!Number.isFinite(startedAt)||now<startedAt)throw Error('Invalid source RTS clock');
  return Math.min(1,Math.max(0,Math.fround(Math.fround(now)-Math.fround(startedAt))/1.4));
}

/** Numeric inactive-map parking only. Live transforms stay on actual actors. */
export type RtsParkingPose={slot:0|1|2;position:{x:number;y:number;z:number};layer:9|10|11;direction:'up'|'right'|'down'|'left'};
export type RtsWorldParking={kind:'source-rts-world-v1';policy:WebRtsPartySwitch;parked:{mapId:number;poses:RtsParkingPose[]}[]};
export function validateRtsParking(raw:RtsWorldParking,catalog:SourceRtsPartyCatalog,currentMap:number):void{
 checkpointKeys(raw,'kind,policy,parked');validateRtsCatalog(catalog);
 if(raw.kind!=='source-rts-world-v1'||raw.policy!==WEB_RTS_PARTY_SWITCH||!Array.isArray(raw.parked))throw Error('Unbound RTS world parking');
 const maps=new Set<number>();for(const row of raw.parked){checkpointKeys(row,'mapId,poses');
  if(row.mapId===currentMap||maps.has(row.mapId)||!catalog.maps.some(m=>m.id===row.mapId)||!Array.isArray(row.poses))throw Error('Invalid inactive RTS map parking');maps.add(row.mapId);
  validateRtsPoses(row.poses);
 }
}
export function validateRtsPoses(poses:readonly RtsParkingPose[]):void{
 const slots=new Set<number>();for(const p of poses){checkpointKeys(p,'slot,position,layer,direction');checkpointKeys(p.position,'x,y,z');
  checkpointInteger(p.slot,0,2);if(slots.has(p.slot)||![9,10,11].includes(p.layer)||Math.trunc(p.position.z)!==({9:349,10:249,11:149}as Record<number,number>)[p.layer]||!['up','right','down','left'].includes(p.direction)||
   Object.values(p.position).some(v=>!Number.isFinite(v)||Math.fround(v)!==v))throw Error('Invalid RTS parked actual pose');slots.add(p.slot);}
}
