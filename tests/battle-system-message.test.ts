import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBattleEventMessage,createBattleEventMessageCompiler } from '../src/compiler/battle-event-message.js';
import { bindBattleEventMessageInput } from '../src/compiler/battle-event-message-bindings.js';
import { parseBattleEventMessageBinding,prepareBattleEventMessagePresentation } from '../src/core/battle-event-message.js';
import { SourceMessageState } from '../src/core/source-message.js';
import { battleMessageDictionariesFixture as fixture,battleMessageDictionariesInput as input } from './fixtures/battle-message-dictionaries.js';
import { messageRaw } from './fixtures/battle-event-message.js';
const op=(key:string,data=input())=>compileBattleEventMessage(messageRaw('Msg',3,key,2),data,'MsgClose');
test('v2 binds every complete dictionary and routes by dictionary membership rather than key spelling',()=>{
 const data=input();assert.equal(data.binding!.kind,'battle-event-message-binding-v2');assert.equal(data.binding!.sources.length,5);
 assert.deepEqual(parseBattleEventMessageBinding(data.binding),data.binding);
 for(const [key,text,speaker]of [['KEY','Full text','Speaker'],['SYSTEM','System text',''],['OTHER','Other table text',''],['SHARED_SPEAKER','System body','Known shared speaker']]){
  const value=op(key!);if(value.command.kind!=='sequence')assert.fail();assert.equal(value.command.document.tokens[0]!.kind,'text');
  assert.equal((value.command.document.tokens[0]as{text:string}).text,text);assert.equal(value.command.speaker,speaker);assert.equal(value.command.seconds,3);
  assert.equal(value.presentation!.sourceWindow,2);assert.equal(value.presentation!.speakerAnchor,'right');assert.equal(value.command.layout.anchor,'bottom');
 }
 const f=fixture();f.field.messages.system_zhc['arbitrary_key' as 'SYSTEM']='New system row';
 const compiled=op('arbitrary_key',bindBattleEventMessageInput(f.field,f.corpus,f.rows));assert.equal(compiled.command.kind,'sequence');
});
test('native empty-speaker semantics require v2, while a missing body never becomes a fallback message',()=>{
 const data=input();assert.throws(()=>op('absent',data),/Missing source battle message body/);
 const legacy={...data,binding:{kind:'battle-event-message-binding-v1' as const,sourceSetHash:data.binding!.sourceSetHash,parentSourceSetHash:data.binding!.parentSourceSetHash,
  sources:data.binding!.sources.slice(0,3).map(({role,source})=>({role:role as 'body'|'speaker'|'character-names',source}))}};
 assert.throws(()=>op('SYSTEM',legacy),/Missing source/);assert.equal(op('KEY',legacy).command.kind,'sequence');
 assert.throws(()=>op('SYSTEM',{messages:data.messages}),/Missing source/);
 const f=fixture();delete(f.field.messages.story_cha_zhc as Record<string,string>).KEY;delete(f.corpus.messages.story_cha_zhc as Record<string,string>).KEY;
 const value=op('KEY',bindBattleEventMessageInput(f.field,f.corpus,f.rows));if(value.command.kind!=='sequence')assert.fail();assert.equal(value.command.speaker,'');
});
test('changed complete table or name content, missing dictionaries, foreign refs and incomplete v2 roles reject before compilation',()=>{
 for(const alter of [(d:ReturnType<typeof input>)=>{(d.messages.system_zhc as Record<string,string>).SYSTEM='tampered';},
  (d:ReturnType<typeof input>)=>{(d.messages.etc_text_zhc as Record<string,string>).OTHER='tampered';},
  (d:ReturnType<typeof input>)=>{(d.characterNames as {tag_name:string}[])[0]!.tag_name='OTHER';},
  (d:ReturnType<typeof input>)=>{delete d.messages.system_zhc;},
  (d:ReturnType<typeof input>)=>{d.binding!.sources.pop();}]){const data=input();alter(data);assert.throws(()=>createBattleEventMessageCompiler(data));}
 for(const alter of [(f:ReturnType<typeof fixture>)=>{f.field.messageSources.splice(2,1);},
  (f:ReturnType<typeof fixture>)=>{f.field.messageSources[2]!.file='foreign';},
  (f:ReturnType<typeof fixture>)=>{f.field.messageSources.push({...f.field.messageSources[2]!});},
  (f:ReturnType<typeof fixture>)=>{f.field.messageSources[2]!.objectId='9223372036854775808';},
  (f:ReturnType<typeof fixture>)=>{f.field.messages.system_zhc={ }as typeof f.field.messages.system_zhc;}]){const f=fixture();alter(f);assert.throws(()=>bindBattleEventMessageInput(f.field,f.corpus,f.rows));}
});
test('same-value and conflicting duplicate body keys both reject ambiguous cross-table routing',()=>{
 for(const text of ['Full text','Conflicting text']){const f=fixture();(f.field.messages.system_zhc as Record<string,string>).KEY=text;assert.throws(()=>bindBattleEventMessageInput(f.field,f.corpus,f.rows),/Duplicate/);}
 const f=fixture();f.field.messages.etc_text_zhc.OTHER='Updated verified row';const data=bindBattleEventMessageInput(f.field,f.corpus,f.rows);
 const compile=createBattleEventMessageCompiler(data);(data.messages.etc_text_zhc as Record<string,string>).OTHER='late mutation';
 const value=compile(messageRaw('Msg',-1,'OTHER'),'MsgClose');if(value.command.kind!=='sequence')assert.fail();assert.equal((value.command.document.tokens[0]as{text:string}).text,'Updated verified row');
});
test('system rows reuse existing held-name and fee templates and the original message owner',()=>{
 const value=op('NAMED');if(value.command.kind!=='sequence')assert.fail();assert.equal(value.command.template!.kind,'field-message-template-v1');
 const owner=new SourceMessageState(),command=value.command;assert.throws(()=>prepareBattleEventMessagePresentation(command,{},owner),/held-name owner/);
 const resolved=prepareBattleEventMessagePresentation(command,{names:{prepare(refs){assert.equal(refs[0]!.tag,'TERRA');return {names:['Held Terra'],validate(){}};}}},owner);
 assert.equal((resolved.command.document.tokens[0]as{text:string}).text,'Hello Held Terra');assert.equal(resolved.command.speaker,'');resolved.validate();
 const fee=op('FEE');if(fee.command.kind!=='sequence')assert.fail();assert.equal(fee.command.template!.kind,'field-message-template-v2');
 const feeCommand=fee.command;assert.throws(()=>prepareBattleEventMessagePresentation(feeCommand,{},owner),/KINGAKU has not been set/);
});
