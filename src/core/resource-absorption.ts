import { calculateDevelopmentEffects, type DevelopmentAbilityPlan, type NumericalEffectResult } from './ability.js';
import type { ActionParticipant } from './action-effects.js';
import type { BattleConditions } from './battle-conditions.js';
import type { PhysicalRowContext } from './battle-row.js';
import { checkpointKeys } from './checkpoint-validation.js';
export const WEB_RESOURCE_ABSORPTION = 'web-source-resource-absorption-deferred-v1' as const;
export type ResourceAbsorptionEffect = {
  kind:'absorb-resource';slot:number;resource:'hp'|'mp';calculation:'magic'|'physical';percent:100;
  forAiType:1|2;recipient:'single-caster';overflow:'normal';
  presentation:{kind:typeof WEB_RESOURCE_ABSORPTION;effectAssetId:number;
    sourceEffect:{assetName:string;positionType:number;displayType:number;soundAssetIds:[number,number,number]}|null;
    originalEffect:'deferred';actionClock:'existing-web-action-stages'};
};
export type ActionResourceState={hp:number;mp:number;conditionIds:number[]};
export type AbsorptionContext={kind:'source-non-reversing-absorption-v1';actorId:string;targetId:string};
export function resourceAbsorptionEffect(plan:DevelopmentAbilityPlan):ResourceAbsorptionEffect|null{
  const result=plan.effects.find((effect):effect is ResourceAbsorptionEffect=>effect.kind==='absorb-resource');
  if(!result)return null;
  checkpointKeys(result,'kind,slot,resource,calculation,percent,forAiType,recipient,overflow,presentation');
  const first=plan.effects[0];
  if(plan.effects.length!==2||plan.effects[1]!==result||first?.slot!==1||result.slot!==2||
      first.kind!==result.calculation||!['hp','mp'].includes(result.resource)||result.percent!==100||
      ![1,2].includes(result.forAiType)||result.recipient!=='single-caster'||result.overflow!=='normal')
    throw Error('Unresolved whole resource absorption composition');
  const p=result.presentation;checkpointKeys(p,'kind,effectAssetId,sourceEffect,originalEffect,actionClock');
  if(p.kind!==WEB_RESOURCE_ABSORPTION||p.originalEffect!=='deferred'||p.actionClock!=='existing-web-action-stages'||
      !Number.isInteger(p.effectAssetId)||p.effectAssetId<0||p.effectAssetId>0x7fffffff||(p.effectAssetId===0)!==(p.sourceEffect===null))
    throw Error('Unresolved source resource absorption presentation policy');
  if(p.sourceEffect){const e=p.sourceEffect;checkpointKeys(e,'assetName,positionType,displayType,soundAssetIds');
    if(typeof e.assetName!=='string'||!e.assetName||e.assetName==='None'||!Array.isArray(e.soundAssetIds)||e.soundAssetIds.length!==3||
        ![e.positionType,e.displayType,...e.soundAssetIds].every(v=>Number.isInteger(v)&&v>=0&&v<=0x7fffffff))
      throw Error('Unbound source resource absorption effect metadata');}
  return result;
}
/** One detached projection, shared with every battle action carrier. The host
 * establishes current non-reversing trait/equipment owners before entering.
 * The primary uses the ordinary numeric calculator exactly once. */
export function projectResourceAbsorption(plan:DevelopmentAbilityPlan,power:number,actor:ActionParticipant,target:ActionParticipant,
  conditions:BattleConditions,random:(min:number,max:number)=>number,cost:number,context:AbsorptionContext|undefined,
  rows?:PhysicalRowContext,abilityId?:number,automaticLife:"settle"|"defer-to-battle-owner"="settle"){
  if (automaticLife !== "settle" && automaticLife !== "defer-to-battle-owner") throw new Error("Invalid action automatic life owner");
  const effect=resourceAbsorptionEffect(plan);if(!effect)throw Error('Missing resource absorption effect');
  if(context?.kind!=='source-non-reversing-absorption-v1'||context.actorId!==actor.id||context.targetId!==target.id)
    throw Error('Resource absorption needs current non-reversing actor/target providers');
  if(!Number.isSafeInteger(cost)||cost<0||cost>actor.mp)throw Error('Invalid absorption payment');
  for(const unit of [actor,target]){
    conditions.validateOwner(unit.conditionIds,unit.side);conditions.validateActive(unit.conditionIds);
    if(![unit.hp,unit.mp,unit.maxHp,unit.maxMp].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=0x7fffffff)||
      unit.maxHp<1||unit.hp>unit.maxHp||unit.mp>unit.maxMp)throw Error('Invalid absorption resource bounds');
    if(conditions.types(unit.conditionIds).some(type=>[9,34,656].includes(type)))throw Error('Unresolved absorption reversal or nullification condition');
  }
  // Cost precedes native hit calculation. Self-targeting sees this same paid
  // instance; it does not manufacture an independent resource owner.
  const paid={...actor,mp:actor.mp-cost},recipient=target.id===actor.id?paid:target,
    elements=conditions.effectiveElements(recipient.conditionIds,recipient.elementResistances,recipient.side),
    attackElements=effect.calculation==='magic'?plan.magic?.elements:actor.attackElements;
  if(!attackElements)throw Error('Missing absorption element provider');
  if(attackElements.some(id=>elements[id]===4))throw Error('Unresolved element-reversed absorption');
  const numerical={...plan,effects:[plan.effects[0]!]},calculated=calculateDevelopmentEffects(numerical,power,
    {...paid,conditionTypes:conditions.types(paid.conditionIds)},
    {...recipient,conditionTypes:conditions.types(recipient.conditionIds),elementResistances:elements},random,1,rows,abilityId);
  if(calculated.length!==1)throw Error('Unexpected absorption primary result');
  const primary=calculated[0]!;if(primary.recovery)throw Error('Unresolved reversed absorption calculation');
  // Native Magic/PhysicsAbsorption clips to the caster deficit; Function13's
  // normal overflow then clips to the target's prior current resource.
  const deficit=(effect.resource==='hp'?paid.maxHp:paid.maxMp)-paid[effect.resource],
    amount=primary.missed||primary.nullified?0:Math.min(primary.amount,deficit,recipient[effect.resource]);
  const targetState:ActionResourceState={hp:recipient.hp,mp:recipient.mp,conditionIds:[...recipient.conditionIds]};
  targetState[effect.resource]-=amount;
  if(effect.resource==='hp')targetState.conditionIds=conditions.updateDying(targetState.hp,target.maxHp,targetState.conditionIds);
  // A shared self-target settles only after both slots; its intermediate zero
  // resource is a draft, never a newly published death component.
  if(automaticLife==="settle"&&target.id!==actor.id)Object.assign(targetState,conditions.settleLife(targetState.hp,targetState.conditionIds,conditions.isUnableFight(recipient.conditionIds)));
  const userState:ActionResourceState=target.id===actor.id?{...targetState,conditionIds:[...targetState.conditionIds]}:
    {hp:paid.hp,mp:paid.mp,conditionIds:[...paid.conditionIds]};
  userState[effect.resource]+=amount;
  if(effect.resource==='hp')userState.conditionIds=conditions.updateDying(userState.hp,actor.maxHp,userState.conditionIds);
  if(automaticLife==="settle")Object.assign(userState,conditions.settleLife(userState.hp,userState.conditionIds,conditions.isUnableFight(paid.conditionIds)));
  if(target.id===actor.id)Object.assign(targetState,userState,{conditionIds:[...userState.conditionIds]});
  const result:NumericalEffectResult={...primary,resource:effect.resource,amount,recovery:false,
    ...(!primary.missed&&(primary.nullified||amount===0)?{nullified:true}:{})};
  return {targets:[{targetId:target.id,state:targetState,effects:[result]}],userConditionIds:[...userState.conditionIds],userResults:[],
    userResourceState:userState,userResourceResults:[{ownerId:actor.id,slot:effect.slot,resource:effect.resource,recovery:true as const,
      amount,missed:primary.missed,...(result.nullified?{nullified:true}:{})}]};
}
