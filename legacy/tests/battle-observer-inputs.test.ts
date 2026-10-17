import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {BattleGame} from '../src/core/battle.js';
import {fixture} from './fixtures/battle-content.js';
const {chooseBattleObserverInput}=await import(pathToFileURL(resolve('scripts/battle-observer-inputs.mjs')).href);
function ready(game:BattleGame){for(let n=0;n<2000&&!game.ready.some(a=>a.id==='a');n++)game.advance(10);assert(game.ready.some(a=>a.id==='a'));}
test('an actual menu without ability 10 supplies its qualified command and group target',()=>{
 const content=fixture();content.commands[100]!.abilityIds=[11];content.players[0]!.abilities=[11];
 const game=new BattleGame(content,314);ready(game);assert.equal(game.canUse('a',10),false);
 const choice=chooseBattleObserverInput(game,'a');assert.equal(choice.kind,'choice');assert.equal(choice.abilityId,11);assert.equal(choice.commandId,100);
 assert(game.command(choice.actorId,choice.abilityId,choice.selection,choice.commandId));
 assert.equal(game.pendingActions.length,1);assert.equal(game.pendingActions[0]!.actor,'a');
});
test('the same ability in two actual commands retains its concrete context instead of submitting an ambiguous input',()=>{
 const content=fixture();content.commands[101]={...structuredClone(content.commands[100]!),id:101};content.players[0]!.commands=[100,101];
 const game=new BattleGame(content,314);ready(game);assert.equal(game.canUse('a',10),false);
 const choice=chooseBattleObserverInput(game,'a');assert.equal(choice.commandId,100);assert.equal(choice.abilityId,10);
 assert(game.command(choice.actorId,choice.abilityId,choice.selection,choice.commandId));assert.equal(game.pendingActions.length,1);
});
test('a ready actor with no legal menu is an explicit boundary and the query changes no combat state',()=>{
 const content=fixture();content.players[0]!.commands=[];const game=new BattleGame(content,314);ready(game);
 const before=structuredClone({units:game.combatants,time:game.time,queue:game.pendingActions,random:Reflect.get(game,'randomState')});
 assert.deepEqual(chooseBattleObserverInput(game,'a'),{kind:'unavailable',policy:'current-menu-qualified-ability-v1',actorId:'a',menu:[]});
 assert.deepEqual({units:game.combatants,time:game.time,queue:game.pendingActions,random:Reflect.get(game,'randomState')},before);
});
