import { checkpointKeys } from './checkpoint-validation.js';
import { FieldFadeState, type FieldFadeOp, type FadeColor } from './field-fade.js';
export const WEB_BATTLE_GLOBAL_FADE='web-source-battle-global-fade-v1' as const;
export type BattleGlobalFadeOp=Omit<FieldFadeOp,'kind'>&{kind:'global-fade'};
/** The Session binds its existing Field owner. A callback or renderer never
 * supplies a completion flag or a second manager. */
export type BattleGlobalFadeHost={policy:typeof WEB_BATTLE_GLOBAL_FADE;owner:FieldFadeState};
export function parseBattleGlobalFadeOp(raw:unknown):BattleGlobalFadeOp {
 checkpointKeys(raw,'kind,direction,seconds,color');const v=raw as BattleGlobalFadeOp;
 if(v.kind!=='global-fade'||!['in','out'].includes(v.direction)||typeof v.seconds!=='number'||!Number.isFinite(v.seconds)||Math.fround(v.seconds)!==v.seconds)throw new Error('Invalid battle global fade instruction');
 let color:FadeColor|null=null;
 if(v.color!==null){checkpointKeys(v.color,'r,g,b,a');for(const x of Object.values(v.color))if(typeof x!=='number'||!Number.isFinite(x)||x<0||x>1||Math.fround(x)!==x)throw new Error('Invalid battle global fade color');color={...v.color};}
 return {kind:v.kind,direction:v.direction,seconds:v.seconds,color};
}
export function validateBattleGlobalFadeHost(host:BattleGlobalFadeHost|undefined):void {
 if(host===undefined)return;checkpointKeys(host,'policy,owner');
 if(host.policy!==WEB_BATTLE_GLOBAL_FADE||!(host.owner instanceof FieldFadeState))throw new Error('Missing actual shared global fade owner');
}
