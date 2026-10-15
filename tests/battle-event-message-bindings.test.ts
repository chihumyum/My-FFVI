import test from "node:test";
import assert from "node:assert/strict";
import { bindBattleEventMessageInput } from "../src/compiler/battle-event-message-bindings.js";
import { hash } from "../src/compiler/content.js";
import type { BattleRow } from "../src/compiler/battle.js";
function fixture() {
 const sources=[{file:"bundles/messages",sha256:"a".repeat(64),bytes:10},{file:"bundles/master",sha256:"b".repeat(64),bytes:20}],parent="c".repeat(64),names=[{id:"1",mes_id_name:"TERRA",character_id:"1"}],messages={story_mes_zhc:{KEY:"Full text"},story_cha_zhc:{KEY:"Speaker"}},
 corpus={sourceSetHash:hash(sources),manifest:{sources,parentSourceSetHash:parent},messages,tables:{"character_default_name.csv":names}},
 field={sources,sourceSetHash:hash(sources),parentSourceSetHash:parent,messages:structuredClone(messages),messageSources:[{file:"messages",assetPath:"texts/story_mes_zhc.txt",objectId:"-9007199254740993"},{file:"messages",assetPath:"texts/story_cha_zhc.txt",objectId:"9007199254740993"}]},
 rows:BattleRow[]=names.map(values=>({values,source:{file:"master",assetPath:"tables/character_default_name.csv",objectId:"9007199254740993",serializedFile:"CAB-authored",rowId:values.id}}));
 return {corpus,field,rows};
}
test("message directories bind all raw text and name rows to physical files without losing signed 64-bit object identities",()=>{
 const f=fixture(),input=bindBattleEventMessageInput(f.field,f.corpus,f.rows);assert.equal(input.binding!.sources[0]!.source.objectId,"-9007199254740993");assert.equal(input.binding!.sources[0]!.source.serializedFile,null);assert.equal(input.binding!.sources[2]!.source.serializedFile,"CAB-authored");
 input.messages.story_mes_zhc={};assert.equal(f.corpus.messages.story_mes_zhc.KEY,"Full text");
});
test("changed raw text, incomplete names, foreign physical files and ambiguous namespaces cannot acquire a message binding",()=>{
 for(const alter of [(f:ReturnType<typeof fixture>)=>{f.field.messages.story_mes_zhc.KEY="tampered";},
  (f:ReturnType<typeof fixture>)=>{f.rows.length=0;},
  (f:ReturnType<typeof fixture>)=>{f.rows[0]!.source.file="foreign";},
  (f:ReturnType<typeof fixture>)=>{f.field.messageSources.push({...f.field.messageSources[0]!});},
  (f:ReturnType<typeof fixture>)=>{f.field.parentSourceSetHash="d".repeat(64);}
 ]){const f=fixture();alter(f);assert.throws(()=>bindBattleEventMessageInput(f.field,f.corpus,f.rows));}
});
