import test from "node:test";
import assert from "node:assert/strict";
import { bindBattleEventMessageInput } from "../src/compiler/battle-event-message-bindings.js";
import { hash } from "../src/compiler/content.js";
import type { BattleRow } from "../src/compiler/battle.js";
import { battleMessageDictionariesFixture as fixture } from "./fixtures/battle-message-dictionaries.js";
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
