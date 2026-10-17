import test from 'node:test';import assert from 'node:assert/strict';
import {sourcePlayAnimationCohort} from './source-play-animation-cohort.mjs';
const op=(name,count=0,decoded=true)=>({raw:{mnemonic:name,operands:{iValues:[0,count]}},site:{index:0},operandDecoded:decoded?'decoded':'blocked',decoded:decoded?{kind:'nop'}:{kind:'blocked'},diagnostic:decoded?null:{reason:'unknown'}});
const program=(id,ops,domain='field')=>({id,source:{file:'synthetic',assetPath:id},raw:{Mnemonics:ops.map(i=>i.raw),Segments:['preserved']},rawHash:id,domain,locals:{operandDecoded:'decoded'},instructions:ops});
function fixture(){return {sourceSetHash:'synthetic',contentHash:'ir',scripts:[program('finite',[op('PlayAnim',3),op('unknown',0,false)]),program('resident',[op('PlayAnim',-1)]),program('dependency',[op('Nop')]),program('alternate',[op('Nop')]),program('non-field',[op('PlayAnim',5)],'not-assessed-by-field-runtime')],analysis:{maps:[{id:'1',residentScripts:{resident:'resident'},scriptAliases:{finite:'finite',dependency:'dependency'}},{id:'2',residentScripts:{resident:'resident'},scriptAliases:{alias:'finite'}}],dependencies:[{site:{asset:'finite'},mapId:'1',kind:'script',resolved:false,candidates:['dependency','alternate']}]}};}
test('whole finite family retains blocked roots, both ambiguous dependencies and complete installed Resident namespace',()=>{
 const raw=fixture(),before=structuredClone(raw),cohort=sourcePlayAnimationCohort(raw);assert.deepEqual(raw,before);
 assert.equal(cohort.counts.familyPhysicalPrograms,3);assert.equal(cohort.counts.allSites,3);assert.equal(cohort.counts.finiteRootBindings,2);
 assert.equal(cohort.counts.finiteMaps,2);assert.equal(cohort.counts.namespaceUses,5);assert.equal(cohort.counts.unassessedSites,0);
 assert.deepEqual(cohort.roots[0].closure.ids,['alternate','dependency','finite']);assert.equal(cohort.roots[0].closure.unresolved.length,1);
 assert.equal(cohort.roots[0].otherwiseOperandClosed,false);assert.equal(cohort.roots[1].otherwiseOperandClosed,false);
 assert.deepEqual(cohort.programs.map(p=>p.id),['alternate','dependency','finite','non-field','resident']);
 assert.equal(cohort.sourceProgramExecution,0);assert.equal(cohort.sourceStoryReachability,false);
 assert.deepEqual(cohort.programs[2].raw.Segments,['preserved']);
});
