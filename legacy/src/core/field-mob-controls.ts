import { checkpointInteger, checkpointKeys } from './checkpoint-validation.js';
import type { FieldContent } from '../field/types.js';
import type { NativeFieldActorData } from './field-native-actors.js';
export const WEB_FLAT_MOB_COLOR_FILTER = 'web-flat-mob-color-filter-v1' as const;
export type WebFlatMobColorFilter = typeof WEB_FLAT_MOB_COLOR_FILTER;
export type FieldMobControlOp = { kind: 'field-mob-control'; command: { kind: 'hide'; exemptions: number[]; durationSeconds: number } | { kind: 'restore'; durationSeconds: number } };
export function parseMobControlCommand(raw: FieldMobControlOp['command']): FieldMobControlOp['command'] {
 if (!raw || !['hide','restore'].includes(raw.kind)) throw new Error('Unknown Mob control command');
 checkpointKeys(raw,raw.kind==='hide'?'kind,exemptions,durationSeconds':'kind,durationSeconds');
 if(!Number.isFinite(raw.durationSeconds)||Math.fround(raw.durationSeconds)!==raw.durationSeconds||raw.durationSeconds<0)throw new Error('Invalid Mob control duration');
 if(raw.kind==='hide'){
  if(!Array.isArray(raw.exemptions)||raw.exemptions.length>5)throw new Error('Invalid Mob exemption list');
  for(const id of raw.exemptions){checkpointInteger(id,-0x80000000,0x7fffffff);if(id===0)throw new Error('Zero is not a Mob exemption selector');}
  return {...raw,exemptions:[...raw.exemptions]};
 }
 return {...raw};
}
export type MobBinding = { mapId: number; contentHash: string };
export type FieldMobColor = { kind: 'web-flat-mob-color-v1'; alpha: number; tween: { target: 0 | 1; durationSeconds: number; startedAtSeconds: number } | null };
export type MobActor = { id: string; native?: NativeFieldActorData; mobColor?: FieldMobColor };
type MemberData = { actorId: string; origin: MobBinding; generation: number; token: number };
type Member = MemberData & ({ kind: 'live'; actor: MobActor; native: NativeFieldActorData; entity: NativeFieldActorData['entity'] } | { kind: 'retired' });
export type FieldMobCheckpoint = { kind: 'field-mob-controls-v1'; generation: number; nextToken: number; members: (MemberData & { kind: 'live' | 'retired' })[]; poses: { actorId: string; alpha: number }[] };
const f = Math.fround;
function float(value: number) { if (!Number.isFinite(value) || !Number.isFinite(f(value))) throw new Error('Invalid Mob color float'); return f(value); }
function binding(value: MobBinding) { checkpointKeys(value, 'mapId,contentHash'); checkpointInteger(value.mapId, 1, 0x7fffffff); if (!/^[a-f0-9]{64}$/.test(value.contentHash)) throw new Error('Unbound Mob map content'); }
function actorId(value: string) { if (typeof value !== 'string' || !value.length || value.trim() !== value) throw new Error('Invalid Mob actor identity'); }
export function validateMobPolicy(value: unknown): asserts value is WebFlatMobColorFilter | undefined { if (value !== undefined && value !== WEB_FLAT_MOB_COLOR_FILTER) throw new Error('Unknown Mob color-filter policy'); }
export function cloneMobColor(value: FieldMobColor): FieldMobColor {
 checkpointKeys(value, 'kind,alpha,tween'); if (value.kind !== 'web-flat-mob-color-v1' || float(value.alpha) !== value.alpha || value.alpha < 0 || value.alpha > 1) throw new Error('Invalid Mob material filter');
 if (value.tween !== null) { checkpointKeys(value.tween, 'target,durationSeconds,startedAtSeconds'); const t = value.tween;
  if (![0,1].includes(t.target) || float(t.durationSeconds) !== t.durationSeconds || t.durationSeconds <= 0 || float(t.startedAtSeconds) !== t.startedAtSeconds) throw new Error('Invalid Mob filter clock'); }
 return structuredClone(value);
}
/** Zero duration immediately writes material but does not cancel an older color fade. */
export function startMobColor(value: FieldMobColor | undefined, target: 0 | 1, durationSeconds: number, nowSeconds: number): FieldMobColor {
 const next = value ? cloneMobColor(value) : { kind: 'web-flat-mob-color-v1' as const, alpha: 0, tween: null }, duration = float(durationSeconds), now = float(nowSeconds);
 if (duration < 0 || ![0,1].includes(target)) throw new Error('Unsupported Mob filter duration/target');
 if (duration === 0) next.alpha = target; else next.tween = { target, durationSeconds: duration, startedAtSeconds: now };
 return next;
}
export function tickMobColor(value: FieldMobColor, nowSeconds: number): FieldMobColor {
 const next = cloneMobColor(value), t = next.tween; if (!t) return next;
 const ratio = float(float(float(nowSeconds) - t.startedAtSeconds) / t.durationSeconds), rate = Math.max(0, Math.min(1, ratio));
 next.alpha = t.target === 1 ? float(rate) : float(1 - rate); if (ratio > 1) next.tween = null; return next;
}
export function fieldMobColorBinding(content: FieldContent, policy: unknown): MobBinding | undefined {
 validateMobPolicy(policy); validateMobPolicy(content.developmentProfile?.mobColorFilter);
 if (policy === undefined || content.developmentProfile?.mobColorFilter !== WEB_FLAT_MOB_COLOR_FILTER) return undefined;
 if (content.developmentProfile?.kind !== 'framework-development-v1' || !content.cameraHost || !content.map.identity ||
     !Number.isInteger(content.map.identity.mapId) || content.map.identity.mapId <= 0 || !/^[a-f0-9]{64}$/.test(content.contentHash)) throw new Error('Mob filter requires trusted map/camera binding');
 return {mapId:content.map.identity.mapId,contentHash:content.contentHash};
}
/** Membership is the only collection here. Material state remains ON real Actors. */
export class FieldMobControls {
 private members: Member[] = []; private nextToken = 1; private generation = 0; private retired = false;
 constructor(readonly map: MobBinding, private readonly actors: () => Readonly<Record<string, MobActor>>) { binding(map); }
 get isRetired(): boolean { return this.retired; }
 private current(member: Extract<Member, {kind:'live'}>) {
  if (this.retired || this.actors()[member.actorId] !== member.actor || member.actor.native !== member.native || member.native.entity !== member.entity) throw new Error('Mob membership lost its actual actor/native instance');
 }
 liveActors(): MobActor[] { return this.members.filter((m):m is Extract<Member,{kind:"live"}>=>m.kind==="live").map(m=>{this.current(m);return m.actor;}); }
 snapshot() { return { ...this.capture(false), retired: this.retired }; }
 prepare(command: FieldMobControlOp['command'], registry: readonly MobActor[], exemptions: readonly (MobActor | null)[], nowSeconds: number, validate: () => void): () => void {
  command=parseMobControlCommand(command);
  if (this.retired) throw new Error('Retired Mob control owner'); if(registry.length>32767)throw new Error('Mob registry exceeds the admitted budget'); const old = this.members, token = this.nextToken;
  const active = command.kind === 'hide' ? registry.filter(actor => actor.native!.entity.visible && !exemptions.includes(actor)) : old.filter((m): m is Extract<Member,{kind:'live'}> => m.kind === 'live').map(m => { this.current(m); return m.actor; });
  if (new Set(active).size !== active.length) throw new Error('Duplicate Mob registered actor');
  const candidates = active.map(actor => {
   const native = actor.native; if (!native || this.actors()[actor.id] !== actor) throw new Error('Mob filter requires actual registered native actor');
   return { actor, native, entity: native.entity, prior: actor.mobColor, next: startMobColor(actor.mobColor, command.kind === 'hide' ? 1 : 0, command.durationSeconds, nowSeconds) };
  });
  checkpointInteger(token+ (command.kind==='hide'?candidates.length:0),1,0x7fffffff);
  const nextMembers: Member[] = command.kind === 'restore' ? old : candidates.map((c,index) => ({ kind: 'live', actorId:c.actor.id, origin:{...this.map}, generation:this.generation, token:token+index, actor:c.actor, native:c.native, entity:c.entity }));
  let published = false;
  return () => {
   validate(); if (published || this.retired || this.members !== old || this.nextToken !== token || candidates.some(c => this.actors()[c.actor.id] !== c.actor || c.actor.native !== c.native || c.native.entity !== c.entity || c.actor.mobColor !== c.prior)) throw new Error('Stale Mob color publication');
   for (const c of candidates) c.actor.mobColor = c.next; this.members = nextMembers;
   if (command.kind === 'hide') this.nextToken = token + candidates.length; published = true;
  };
 }
 private capture(stable: boolean): FieldMobCheckpoint {
  const poses = Object.values(this.actors()).flatMap(actor => { if (!actor.mobColor) return []; const color = cloneMobColor(actor.mobColor); if (stable && color.tween) throw new Error('Active Mob filter cannot be checkpointed'); return [{actorId:actor.id,alpha:color.alpha,...(!stable?{tween:color.tween}:{})}]; });
  return {kind:'field-mob-controls-v1',generation:this.generation,nextToken:this.nextToken,members:this.members.map(member => { if (member.kind === 'live') this.current(member); const {actorId,origin,generation,token,kind}=member;return {actorId,origin:{...origin},generation,token,kind}; }),poses};
 }
 checkpoint(): FieldMobCheckpoint { if (this.retired) throw new Error('Retired Mob owner cannot save'); return this.capture(true); }
 transferFrom(previous: FieldMobControls): void {
  if (previous.retired) throw new Error('Cannot transfer a retired Mob owner');
  if (this.members.length || this.generation !== 0 || this.nextToken !== 1) throw new Error('Mob map transfer requires a fresh candidate');
  const source = previous.capture(false); this.generation = source.generation + 1; checkpointInteger(this.generation,1,0x7fffffff); this.nextToken=source.nextToken;
  this.members=source.members.map(member => ({...member,origin:{...member.origin},kind:'retired'}));
 }
 retire(): void { this.members=this.members.map(member => {const {actorId,origin,generation,token}=member;return {kind:'retired',actorId,origin,generation,token};});this.retired=true; }
 restore(saved: FieldMobCheckpoint): void {
  checkpointKeys(saved,'kind,generation,nextToken,members,poses');if(saved.kind!=='field-mob-controls-v1'||!Array.isArray(saved.members)||!Array.isArray(saved.poses)||saved.members.length>32767||saved.poses.length>32767)throw new Error('Invalid Mob checkpoint');
  checkpointInteger(saved.generation,0,0x7fffffff);checkpointInteger(saved.nextToken,1,0x7fffffff);const tokens=new Set<number>(),live=new Set<string>();
  const members:Member[]=saved.members.map(m=>{checkpointKeys(m,'kind,actorId,origin,generation,token');actorId(m.actorId);binding(m.origin);checkpointInteger(m.generation,0,saved.generation);checkpointInteger(m.token,1,saved.nextToken-1);if(tokens.has(m.token)||!['live','retired'].includes(m.kind))throw new Error('Invalid Mob member token/kind');tokens.add(m.token);
   if(m.kind==='retired')return {...m,origin:{...m.origin},kind:'retired'};
   const actor=this.actors()[m.actorId];if(!actor?.native||live.has(m.actorId)||m.generation!==saved.generation||m.origin.mapId!==this.map.mapId||m.origin.contentHash!==this.map.contentHash)throw new Error('Saved Mob live member cannot grant an actor');live.add(m.actorId);return {...m,origin:{...m.origin},kind:'live',actor,native:actor.native,entity:actor.native.entity};});
  const seen=new Set<string>(),poses=saved.poses.map(p=>{checkpointKeys(p,'actorId,alpha');actorId(p.actorId);const actor=this.actors()[p.actorId];if(!actor?.native||seen.has(p.actorId)||float(p.alpha)!==p.alpha||p.alpha<0||p.alpha>1)throw new Error('Saved Mob pose cannot grant an actor');seen.add(p.actorId);return {actor,color:{kind:'web-flat-mob-color-v1' as const,alpha:p.alpha,tween:null}};});
  if([...live].some(id=>!seen.has(id)))throw new Error('Saved Mob membership lacks its material state');
  for(const p of poses)p.actor.mobColor=p.color;this.members=members;this.nextToken=saved.nextToken;this.generation=saved.generation;
 }
}
