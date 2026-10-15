import assert from 'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';import{resolve}from'node:path';import{createHash}from'node:crypto';
const [input,output]=process.argv.slice(2);assert.ok(input&&output);const bytes=await readFile(resolve(input)),report=JSON.parse(bytes),maps=new Map(report.maps.map(row=>[row.mapId,row]));
function family(reason){for(const [pattern,key]of[
 [/Custom map actor view|tile shader|Unknown source actor view layer/,'map-material-view'],
 [/particle provider|serialized particle/,'serialized-particle-host'],[/Unsupported entity kind/,'entity-factory-kind'],
 [/Background visibility, transform/,'map-background-host'],[/重复实体组激活/,'entity-group-reactivation'],
 [/Missing owned message character/,'unassessed-story-owned-roster'],[/Camera source Move/,'camera-script-movement-host'],
 [/no Awake cores/,'exec-puppet-warning-path'],[/Source message sequence profile\/timing/,'driver-missing-existing-web-message-policy'],
 [/Unsupported NPC movement controller/,'npc-activity-host-or-declaration'],[/minimap provider/,'minimap-host'],
 [/choice input is not declared|\"kind\":\"encounter\"/,'unassessed-declared-player-input'],
 [/Unknown initial field fade host/,'field-screen-fader-initial-host'],[/Condition|condition|stand-in/,'condition-actor-host'],[/visibility|Visibility|fade|Fade/,'visibility-host-or-lifetime'],
 ])if(pattern.test(reason))return key;return'other-explicit-unready';}
const cases=report.cases.map(row=>{const map=maps.get(row.mapId),reason=row.atFailure?.stop?.message??(map?.status==='unready'?map.reason:row.reason)?.split('\n')[0]??null,
 passed=row.status.endsWith('-passed'),stage=passed?'whole-main-stable-save-restore':map?.status==='unready'?'private-framework-derivation':!row.before?'runtime-factory-or-source-initializer':'whole-source-main';
 return{programId:row.programId,mapId:row.mapId,name:row.name,controlledRoster:row.controlledRoster??false,
 sourceStoryReachability:false,status:row.status,stage,family:passed?'controlled-whole-main-passed':family(reason??''),reason,
 actualSourceSite:row.atFailure?.stop?.site??null,actualVisibility:row.actualVisibilityTransactions??row.atFailure?.visibility??[],
 declaredFlagWriteSites:row.declaredFlagWriteSites??null,actualFlagInstructionExecutions:'unassessed'};});
const tally=rows=>Object.fromEntries([...Map.groupBy(rows,row=>row.family)].map(([key,value])=>[key,value.length]).sort(([a],[b])=>a.localeCompare(b)));
const value={kind:'source-visibility-whole-program-classification-v1',input:resolve(input),inputSha256:createHash('sha256').update(bytes).digest('hex'),
 runtimeSha256:report.runtimeSha256,counts:report.counts,baseline:tally(cases.filter(row=>!row.controlledRoster)),researchRoster:tally(cases.filter(row=>row.controlledRoster)),
 sourceStoryReachability:false,nativeParity:false,rule:'First actual failure only; does not erase later external dependencies or interpret controlled roster joins as story reachability.',cases};
await writeFile(resolve(output),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify({counts:value.counts,baseline:value.baseline,researchRoster:value.researchRoster}));
