import { bindBattleEventMessageInput } from '../../src/compiler/battle-event-message-bindings.js';
import { hash } from '../../src/compiler/content.js';
import type { BattleRow } from '../../src/compiler/battle.js';
export function battleMessageDictionariesFixture() {
  const sources = [{file:'bundles/messages',sha256:'a'.repeat(64),bytes:10},{file:'bundles/master',sha256:'b'.repeat(64),bytes:20}],
    parent='c'.repeat(64), names=[{id:'1',mes_id_name:'TERRA',character_id:'1',tag_name:'TERRA'}],
    messages={story_mes_zhc:{KEY:'Full text'},story_cha_zhc:{KEY:'Speaker',SHARED_SPEAKER:'Known shared speaker'}};
  const corpus={sourceSetHash:hash(sources),manifest:{sources,parentSourceSetHash:parent},messages,tables:{'character_default_name.csv':names}},
    field={formatVersion:1,adapterVersion:'field-0.1.1',sources,sourceSetHash:hash(sources),parentSourceSetHash:parent,
      messages:{...structuredClone(messages),system_zhc:{SYSTEM:'System text',NAMED:'Hello (TERRA)',FEE:'Pay (KINGAKU)',SHARED_SPEAKER:'System body'},etc_text_zhc:{OTHER:'Other table text'}},
      messageSources:[{file:'messages',assetPath:'texts/story_mes_zhc.txt',objectId:'-9007199254740993'},
        {file:'messages',assetPath:'texts/story_cha_zhc.txt',objectId:'9007199254740993'},
        {file:'messages',assetPath:'texts/system_zhc.txt',objectId:'-9223372036854775808'},
        {file:'messages',assetPath:'texts/etc_text_zhc.txt',objectId:'9223372036854775807'}]},
    rows:BattleRow[]=names.map(values=>({values,source:{file:'master',assetPath:'tables/character_default_name.csv',objectId:'9007199254740993',serializedFile:'CAB-authored',rowId:values.id}}));
  return {corpus,field,rows};
}
export function battleMessageDictionariesInput() { const f=battleMessageDictionariesFixture(); return bindBattleEventMessageInput(f.field,f.corpus,f.rows); }
