import type {BattleConditions} from './battle-conditions.js';
import {checkpointKeys} from './checkpoint-validation.js';
import {ownedConditionTargets} from './owned-condition.js';
import {int32} from './script-integer.js';
import type {PartyState} from './party.js';
import type {FieldRecoveryMember,FieldRecoveryProjection} from './field-recovery.js';

export type FieldHpChangeCommand = {kind:'subtract-hp';amount:number}|{kind:'revive-current-corps'};

/** Misc captures the double operand in a native float, then its mode0 delegate
 * casts to int before Owned.SubtractionHp takes Abs. Reject overflow domains. */
export function sourceFieldHpSubtraction(amount:number):number {
  if(typeof amount!=='number'||!Number.isFinite(amount))throw Error('Invalid source field HP subtraction');
  const value=int32(Math.trunc(Math.fround(amount)));
  if(value===-0x80000000)throw Error('Source field HP subtraction absolute overflow');
  return Math.abs(value);
}
export function validateFieldHpChangeCommand(command:FieldHpChangeCommand):void {
  if(command.kind==='subtract-hp'){
    checkpointKeys(command,'kind,amount');sourceFieldHpSubtraction(command.amount);
  }else if(command.kind==='revive-current-corps')checkpointKeys(command,'kind');
  else throw Error('Unknown source field HP change');
}

/** Pure projection for existing GameState/current draft ownership. Both native
 * entry points walk current Corps cells, including disabled current members;
 * neither uses enabled-roster selection or refreshes field actors. */
export function projectFieldHpChange<T extends FieldRecoveryMember>(roster:readonly T[],party:PartyState,
  command:FieldHpChangeCommand,conditions:BattleConditions):FieldRecoveryProjection<T> {
  validateFieldHpChangeCommand(command);
  const targets=ownedConditionTargets(roster,party,0),next=structuredClone([...roster]);
  const amount=command.kind==='subtract-hp'?sourceFieldHpSubtraction(command.amount):0;
  if(command.kind==='revive-current-corps'&&conditions.referenceTypes([5])[0]!==5)
    throw Error('Changed source revival master row5');
  for(const targetId of targets){const member=next.find(m=>m.id===targetId)!;
    if(int32(member.maxHp)<1||int32(member.hp)<0||member.hp>member.maxHp||
       int32(member.maxMp)<0||int32(member.mp)<0||member.mp>member.maxMp)
      throw Error('Invalid source field HP owner');
    conditions.validateOwner(member.conditionIds,'player');
    conditions.validateStableLife(member.hp,member.conditionIds);
  }
  for(const targetId of targets){const member=next.find(m=>m.id===targetId)!;
    if(command.kind==='subtract-hp'){
      if(member.hp===0)continue;
      member.hp=Math.max(1,member.hp-amount);
      member.conditionIds=conditions.afterFieldHpSubtraction(member.hp,member.maxHp,member.conditionIds);
    }else if(conditions.referenceTypes(member.conditionIds).includes(5)){
      // Current.ReviveUnableFightCharacters removes ROW5 with duplicate=true,
      // not all rows of type5. Unknown/alias residue must not be repaired.
      member.conditionIds=member.conditionIds.filter(id=>id!==5);
      member.hp=Math.min(member.hp+1,member.maxHp);
      member.conditionIds=conditions.updateDying(member.hp,member.maxHp,member.conditionIds);
      member.conditionIds=conditions.updateDying(member.hp,member.maxHp,member.conditionIds);
    }
    conditions.validateStableLife(member.hp,member.conditionIds);
  }
  return{roster:next,targets,steps:[]};
}
