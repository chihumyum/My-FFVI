import { canonical } from './canonical.js';
import type { FieldContent } from '../field/types.js';
import { parseMapEntryViewPlan } from './map-view.js';

/** Explicit 2D Web controller/presentation. Does not instantiate Unity's Bird
 * renderer, airship puppet/shadow, delegate or render-target registrations. */
export const WEB_FLAT_FIELD_VIEW_CHANGE = 'web-flat-field-view-change-v1' as const;
/** Adds the separately declared retained ground transportation host. The
 * original v1 stays walking-only; saved data never grants either policy. */
export const WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE = 'web-flat-field-view-change-v2' as const;
export type WebFlatFieldViewChange = typeof WEB_FLAT_FIELD_VIEW_CHANGE | typeof WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE;
export function validateFieldViewChangePolicy(policy:unknown):asserts policy is WebFlatFieldViewChange|undefined {
  if(policy!==undefined&&policy!==WEB_FLAT_FIELD_VIEW_CHANGE&&policy!==WEB_FLAT_RETAINED_FIELD_VIEW_CHANGE)throw new Error('Unknown field view change policy');
}
export type FieldViewChangeCommand = { kind:'change-view'; requestedViewType:0|1; timeScale:number; wait:boolean };
export type FieldViewChangeOp = { kind:'field-view-change'; command:FieldViewChangeCommand };
export type FieldViewBinding = { mapId:number; isWorld:boolean; fieldContentHash:string };
export type FieldDynamicView = { kind:'web-flat-field-view-v1'; policy:WebFlatFieldViewChange;
  binding:FieldViewBinding; requestedViewType:0|1; mapViewType:0|1|2; presentationViewType:0 };
export function viewDataKeys(raw:unknown, expected:string): asserts raw is Record<string,unknown> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw new Error('Invalid field view data');
  const names=expected.split(',').sort(), own=Reflect.ownKeys(raw);
  if(own.length!==names.length||own.some(k=>typeof k!=='string')||
    (own as string[]).sort().some((k,i)=>k!==names[i])||own.some(k=>{const d=Object.getOwnPropertyDescriptor(raw,k)!;return !d.enumerable||!('value' in d);}))throw new Error('Invalid field view data fields');
}
export function parseFieldViewChangeCommand(raw:FieldViewChangeCommand):FieldViewChangeCommand {
  viewDataKeys(raw,'kind,requestedViewType,timeScale,wait');
  if(raw.kind!=='change-view'||![0,1].includes(raw.requestedViewType)||typeof raw.wait!=='boolean'||
    typeof raw.timeScale!=='number'||!Number.isFinite(raw.timeScale)||raw.timeScale<=0||Math.fround(raw.timeScale)!==raw.timeScale)throw new Error('Unsupported field view change command');
  return {kind:'change-view',requestedViewType:raw.requestedViewType,timeScale:raw.timeScale,wait:raw.wait};
}
export function parseFieldViewBinding(raw:FieldViewBinding):FieldViewBinding {
  viewDataKeys(raw,'mapId,isWorld,fieldContentHash');
  if(!Number.isSafeInteger(raw.mapId)||raw.mapId<=0||typeof raw.isWorld!=='boolean'||! /^[0-9a-f]{64}$/.test(raw.fieldContentHash))throw new Error('Invalid field view source binding');
  return {...raw};
}
export function fieldViewBinding(content:FieldContent,policy:WebFlatFieldViewChange|undefined):FieldViewBinding|undefined {
  if(policy===undefined)return undefined;
  validateFieldViewChangePolicy(policy);
  if(!content.entry.viewPlan)return undefined;
  const plan=parseMapEntryViewPlan(content.entry.viewPlan);
  if(plan.mapId!==content.map.identity?.mapId||plan.presentationViewType!==0||!content.cameraHost)throw new Error('Field view requires its trusted map/camera presentation');
  return parseFieldViewBinding({mapId:plan.mapId,isWorld:plan.isWorld,fieldContentHash:content.contentHash});
}
export function parseFieldDynamicView(raw:FieldDynamicView,expected?:FieldViewBinding,hostPolicy?:WebFlatFieldViewChange):FieldDynamicView {
  viewDataKeys(raw,'kind,policy,binding,requestedViewType,mapViewType,presentationViewType');
  const binding=parseFieldViewBinding(raw.binding);
  validateFieldViewChangePolicy(raw.policy);validateFieldViewChangePolicy(hostPolicy);
  if(raw.kind!=='web-flat-field-view-v1'||raw.policy===undefined||hostPolicy===WEB_FLAT_FIELD_VIEW_CHANGE&&raw.policy!==hostPolicy||![0,1].includes(raw.requestedViewType)||
    raw.presentationViewType!==0||raw.mapViewType!==(binding.isWorld?(raw.requestedViewType===0?2:1):0)||
    expected&&canonical(binding)!==canonical(parseFieldViewBinding(expected)))throw new Error('Field view source/policy mismatch');
  return {...raw,binding};
}
/** Native non-world Bird returns BEFORE owner writes. It is a recorded branch
 * return, never a new current view. World Normal is FlatBird2, not Normal0. */
export function projectFieldViewChange(binding:FieldViewBinding,raw:FieldViewChangeCommand,policy:WebFlatFieldViewChange=WEB_FLAT_FIELD_VIEW_CHANGE):FieldDynamicView|null {
  validateFieldViewChangePolicy(policy);
  binding=parseFieldViewBinding(binding);const command=parseFieldViewChangeCommand(raw);
  if(!binding.isWorld&&command.requestedViewType===1)return null;
  return {kind:'web-flat-field-view-v1',policy,binding,
    requestedViewType:command.requestedViewType,mapViewType:binding.isWorld?(command.requestedViewType===0?2:1):0,presentationViewType:0};
}
