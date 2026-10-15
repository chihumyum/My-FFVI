import { checkpointKeys,checkpointInteger } from './checkpoint-validation.js';
import { canonical } from './canonical.js';
import { FieldColorFilterState,type FieldColorFilterSnapshot } from './field-screen-effects.js';
import type { FadeColor } from './field-fade.js';
import type { FieldContent } from '../field/types.js';
export const WEB_FIELD_SCREEN_PRESENTATION='web-field-screen-presentation-2d-v1' as const;
export type WebFieldScreenPresentation=typeof WEB_FIELD_SCREEN_PRESENTATION;
export type FieldScreenPresentationCommand=
 | {kind:'preset';preset:1|3;fadeIn:boolean;seconds:number;sourceCenter:{x:number;y:number}}
 | {kind:'monochrome';enabled:boolean}
 | {kind:'sepia-sickness';action:'start'|'stop'|'playing'}
 | {kind:'backdrop';seconds:number;color:FadeColor};
type Parameter='sepia_ratio'|'amplitude'|'blur_ratio';
type Task={ticket:number;parameter:Parameter;start:number;end:number;seconds:number;elapsed:number};
export type FieldScreenPresentationSnapshot={kind:'web-field-screen-presentation-state-v1';policy:WebFieldScreenPresentation;sourceSetHash:string;
 clockMs:number;nextTicket:number;monochrome:boolean;raster:boolean;parameters:Record<Parameter,number>;tasks:Task[];backdrop:FieldColorFilterSnapshot};
export function validateScreenPresentationPolicy(value:unknown):asserts value is WebFieldScreenPresentation|undefined {
 if(value!==undefined&&value!==WEB_FIELD_SCREEN_PRESENTATION)throw Error('Unknown Web2D screen presentation policy');
}
export function fieldScreenPresentationBinding(content:FieldContent,policy:WebFieldScreenPresentation|undefined):string|undefined {
 validateScreenPresentationPolicy(policy);validateScreenPresentationPolicy(content.developmentProfile?.screenPresentation);
 if(policy===undefined||content.developmentProfile?.screenPresentation!==policy||content.developmentProfile.storyRuntime!=='web-field-story-runtime-v1')return undefined;
 if(!/^[a-f0-9]{64}$/.test(content.parentSourceSetHash))throw Error('Unbound screen presentation source identity');
 return content.parentSourceSetHash;
}
const parameters=['sepia_ratio','amplitude','blur_ratio']as const,f=Math.fround;
function scalar(n:number,min=0,max=Number.MAX_VALUE){if(!Number.isFinite(n)||f(n)!==n||n<min||n>max)throw Error('Invalid Web screen presentation scalar');}
function color(c:FadeColor){checkpointKeys(c,'r,g,b,a');for(const k of ['r','g','b','a']as const)scalar(c[k],0,1);}
const binding=(sourceSetHash:string)=>({kind:'web-field-screen-effects-v1' as const,host:'ordinary-field' as const,sourceSetHash});
export function parseFieldScreenPresentationCommand(raw:FieldScreenPresentationCommand):FieldScreenPresentationCommand {
 switch(raw.kind){
 case'preset':checkpointKeys(raw,'kind,preset,fadeIn,seconds,sourceCenter');if(![1,3].includes(raw.preset)||typeof raw.fadeIn!=='boolean')throw Error('Unknown source screen preset or polarity');scalar(raw.seconds);checkpointKeys(raw.sourceCenter,'x,y');checkpointInteger(raw.sourceCenter.x,-0x80000000,0x7fffffff);checkpointInteger(raw.sourceCenter.y,-0x80000000,0x7fffffff);break;
 case'monochrome':checkpointKeys(raw,'kind,enabled');if(typeof raw.enabled!=='boolean')throw Error('Unknown monochrome request');break;
 case'sepia-sickness':checkpointKeys(raw,'kind,action');if(!['start','stop','playing'].includes(raw.action))throw Error('Unknown sepia task request');break;
 case'backdrop':checkpointKeys(raw,'kind,seconds,color');scalar(Math.abs(raw.seconds));color(raw.color);break;
 default:throw Error('Unknown screen presentation command');
 }
 return structuredClone(raw);
}
/** Sole new logical owner. Original FadeManager and ColorFade owners remain
 * separate. Numeric tasks never retain native delegates or another Field. */
export class FieldScreenPresentationState {
 private value:FieldScreenPresentationSnapshot;
 private backdrop:FieldColorFilterState;
 constructor(readonly sourceSetHash:string){
  if(!/^[a-f0-9]{64}$/.test(sourceSetHash))throw Error('Unbound screen presentation source');
  this.backdrop=new FieldColorFilterState(binding(sourceSetHash),{r:0,g:0,b:0,a:1});
  this.value={kind:'web-field-screen-presentation-state-v1',policy:WEB_FIELD_SCREEN_PRESENTATION,sourceSetHash,clockMs:0,nextTicket:1,monochrome:false,raster:false,parameters:{sepia_ratio:0,amplitude:0,blur_ratio:0},tasks:[],backdrop:this.backdrop.snapshot()!};
 }
 get active(){return this.value.tasks.length>0||this.backdrop.active;}
 get backdropPending(){return this.backdrop.active;}
 snapshot(){return structuredClone({...this.value,backdrop:this.backdrop.snapshot()!});}
 get projection(){const s=this.snapshot();return{policy:s.policy,clockMs:s.clockMs,monochrome:s.monochrome,raster:s.raster,parameters:s.parameters,backdrop:s.backdrop.color};}
 static restore(raw:FieldScreenPresentationSnapshot,sourceSetHash:string):FieldScreenPresentationState {
  checkpointKeys(raw,'kind,policy,sourceSetHash,clockMs,nextTicket,monochrome,raster,parameters,tasks,backdrop');
  if(raw.kind!=='web-field-screen-presentation-state-v1'||raw.policy!==WEB_FIELD_SCREEN_PRESENTATION||raw.sourceSetHash!==sourceSetHash||typeof raw.monochrome!=='boolean'||typeof raw.raster!=='boolean')throw Error('Screen presentation source/policy mismatch');
  checkpointInteger(raw.clockMs,0,Number.MAX_SAFE_INTEGER);checkpointInteger(raw.nextTicket,1,Number.MAX_SAFE_INTEGER);checkpointKeys(raw.parameters,'sepia_ratio,amplitude,blur_ratio');
  for(const p of parameters)scalar(raw.parameters[p],0,p==='amplitude'?5:1);
  if(!Array.isArray(raw.tasks))throw Error('Invalid screen presentation task queue');let ticket=0;
  for(const t of raw.tasks){checkpointKeys(t,'ticket,parameter,start,end,seconds,elapsed');checkpointInteger(t.ticket,1,raw.nextTicket-1);if(t.ticket<=ticket||!parameters.includes(t.parameter))throw Error('Invalid screen presentation task identity');ticket=t.ticket;scalar(t.start,0,t.parameter==='amplitude'?5:1);scalar(t.end,0,t.parameter==='amplitude'?5:1);scalar(t.seconds);scalar(t.elapsed);if(t.elapsed>0&&t.elapsed>=t.seconds)throw Error('Completed screen task was not retired');}
  const state=new FieldScreenPresentationState(sourceSetHash);state.backdrop=FieldColorFilterState.restore(raw.backdrop,binding(sourceSetHash));state.value=structuredClone(raw);return state;
 }
 prepare(raw:FieldScreenPresentationCommand):{flow:'next'|'wait';commit():void} {
  const command=parseFieldScreenPresentationCommand(raw),before=canonical(this.snapshot()),draft=FieldScreenPresentationState.restore(this.snapshot(),this.sourceSetHash);
  const add=(parameter:Parameter,start:number,end:number,seconds:number)=>{draft.value.tasks.push({ticket:draft.value.nextTicket++,parameter,start,end,seconds:f(seconds),elapsed:0});};
  const preset=(id:1|3,fadeIn:boolean,seconds:number)=>{const rows=id===1?[['sepia_ratio',1]as const]:[['amplitude',5]as const,['blur_ratio',1]as const];for(const[p,max]of rows)add(p,fadeIn?0:max,fadeIn?max:0,seconds);if(id===3)draft.value.raster=true;};
  let flow:'next'|'wait'='next';
  if(command.kind==='preset')preset(command.preset,command.fadeIn,command.seconds);
  else if(command.kind==='monochrome')draft.value.monochrome=command.enabled;
  else if(command.kind==='sepia-sickness'){
   if(command.action!=='stop')preset(1,true,0);
   preset(3,command.action!=='stop',command.action==='playing'?0:f(.7));
  }else flow=draft.backdrop.start({kind:'field-color-fade',color:command.color,seconds:command.seconds,policy:'web-field-screen-effects-v1'});
  const next=draft.snapshot(),nextBackdrop=FieldColorFilterState.restore(next.backdrop,binding(this.sourceSetHash));FieldScreenPresentationState.restore(next,this.sourceSetHash);let used=false;
  return{flow,commit:()=>{if(used||canonical(this.snapshot())!==before)throw Error('Stale screen presentation transaction');used=true;this.value=next;this.backdrop=nextBackdrop;}};
 }
 advance(milliseconds:number):void {
  checkpointInteger(milliseconds,0,0x7fffffff);if(milliseconds===0)return;const next=FieldScreenPresentationState.restore(this.snapshot(),this.sourceSetHash);next.value.clockMs+=milliseconds;checkpointInteger(next.value.clockMs,0,Number.MAX_SAFE_INTEGER);
  for(const t of next.value.tasks){t.elapsed=f(t.elapsed+f(milliseconds/1000));const ratio=t.seconds===0?1:Math.min(1,f(t.elapsed/t.seconds)),ease=f(ratio*ratio);next.value.parameters[t.parameter]=f(t.start+f(f(t.end-t.start)*ease));}
  next.value.tasks=next.value.tasks.filter(t=>t.seconds>0&&t.elapsed<t.seconds);next.backdrop.advance(milliseconds/1000);this.value=next.value;this.backdrop=next.backdrop;
 }
}
