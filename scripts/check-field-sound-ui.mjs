// Actual AudioOutput / audioProjection with controlled fetch and WebAudio.
// This does not claim browser decoder, device output or original-game parity.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2);
assert.ok(args.length===0||args.length===2&&args[0]==='--compiled-dir','Use --compiled-dir <directory>');
const compiled=resolve(root,args[1]??'dist'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=await readFile(root+'apps/game/audio.js','utf8'),script=source.replace('"/runtime/core/static-audio.js"',JSON.stringify(pathToFileURL(resolve(compiled,'src/core/static-audio.js')).href));
assert.notEqual(source,script);
const {AudioOutput,audioProjection}=await import('data:text/javascript;base64,'+Buffer.from(script).toString('base64'));
const {FieldSoundState}=await import(pathToFileURL(resolve(compiled,'src/core/field-sound.js')).href);
const outputPath=root+'build/reports/field-sound-ui-check.json';await mkdir(root+'build/reports',{recursive:true});await rm(outputPath,{force:true});
const tests=[],originalFetch=globalThis.fetch,assets=new Map();let fetches=0;
function asset(name,options={}){
 const sampleRate=1000,frames=options.frames??1000,channels=options.channels??2;
 const bytes=Buffer.from(JSON.stringify({name,sampleRate,frames,channels}));
 const track={file:'/controlled/'+name+'.flac',sha256:sha(bytes),sampleRate,frames,channels,loop:options.loop??null,...(options.gain===undefined?{}:{gain:options.gain}),source:{file:'controlled',assetPath:name},tableSource:{file:'controlled',assetPath:'sound-table'}};
 assets.set(track.file,{bytes,track});return track;
}
const response=bytes=>({ok:true,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
globalThis.fetch=async url=>{fetches++;const entry=assets.get(url);assert.ok(entry,'Only declared synthetic resources may load');return response(entry.bytes);};
function parameter(){return{value:1,events:[],cancelScheduledValues(t){this.events.push(['cancel',t]);},setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);},linearRampToValueAtTime(v,t){this.events.push(['linear',v,t]);}};}
function node(type){return{type,connections:[],disconnects:0,connect(target){this.connections.push(target);return target;},disconnect(){this.disconnects++;}};}
function output(){
 const records={sources:[],gains:[],panners:[],resumes:0,suspends:0,decodes:0};
 const context={currentTime:0,
  async decodeAudioData(raw){records.decodes++;const data=JSON.parse(Buffer.from(raw).toString());return{numberOfChannels:data.channels,duration:data.frames/data.sampleRate,sampleRate:data.sampleRate};},
  createBufferSource(){const source={...node('source'),starts:[],stops:0,start(...args){this.starts.push(args);},stop(){this.stops++;}};records.sources.push(source);return source;},
  createGain(){const gain={...node('gain'),gain:parameter()};records.gains.push(gain);return gain;},
  createStereoPanner(){const pan={...node('panner'),pan:parameter()};records.panners.push(pan);return pan;},
  async resume(){records.resumes++;},async suspend(){records.suspends++;},
 };
 const audio=new AudioOutput();audio.context=context;audio.master=context.createGain();return{audio,context,records};
}
const voice=(id,track=1,changes={})=>({id,track,started:0,seek:0,fadeIn:0,stop:null,pan:0,...changes});
const project=(id,track,changes={})=>({id,track,voice:voice(Number(id.split(':')[1])||1,1,changes),time:0});
const media=(tracks)=>({sourceSetHash:'synthetic',tracks});
const play=(soundId=1,changes={})=>({kind:'play',soundId,asynchronous:true,handleSlot:null,fadeSeconds:0,seekSeconds:0,pan:0,...changes});
async function check(name,body){await body();tests.push({name,pass:true});}
try{
 await check('audioProjection namespaces equal BGM, environment and SE IDs with their own media',async()=>{
  const tracks=[asset('namespace-bgm'),asset('namespace-environment'),asset('namespace-se')],field={content:{}};
  ['bgm','environment','se'].forEach((kind,index)=>{field[kind]={time:0,voices:[voice(7)]};field.content[kind]=media({1:tracks[index]});});
  const projections=audioProjection(field);assert.deepEqual(projections.map(p=>p.id),['bgm:7','environment:7','se:7']);assert.deepEqual(projections.map(p=>p.track),tracks);
  const {audio,records}=output();await audio.prepare(projections);audio.project(projections,true);
  assert.equal(records.sources.length,3);assert.equal(audio.nodes.size,3);
  projections.forEach((p,index)=>assert.equal(records.sources[index].buffer,audio.buffers.get(p.track.sha256)));
 });
 await check('two simultaneous SE handles share decoded bytes but never a playback node',async()=>{
  const track=asset('overlap'),projections=[project('se:10',track),project('se:11',track)],{audio,records}=output(),before=fetches;
  await audio.prepare(projections);audio.project(projections,true);assert.equal(fetches-before,1);assert.equal(records.decodes,1);assert.equal(records.sources.length,2);
  assert.notEqual(audio.nodes.get('se:10').source,audio.nodes.get('se:11').source);
  audio.project(projections,true);assert.equal(records.sources.length,2);
  audio.project([projections[1]],true);assert.equal(records.sources[0].stops,1);assert.equal(records.sources[1].stops,0);
 });
 await check('source seek and loop sample positions reach the real node; nonzero pan uses StereoPanner',async()=>{
  const track=asset('pan-loop',{loop:{start:200,end:800},gain:0.5}),{audio,records}=output();
  const projection={id:'se:12',track,voice:voice(12,1,{started:100,seek:0.35,pan:0.6}),time:1450};
  await audio.prepare([projection]);audio.project([projection],true);
  const node=audio.nodes.get('se:12');assert.equal(node.source.loop,true);assert.equal(node.source.loopStart,0.2);assert.equal(node.source.loopEnd,0.8);
  assert.ok(Math.abs(node.source.starts[0][1]-0.5)<1e-12);assert.equal(node.pan.pan.value,0.6);
  assert.deepEqual(node.source.connections,[node.gain]);assert.deepEqual(node.gain.connections,[node.pan]);assert.deepEqual(node.pan.connections,[audio.master]);
  assert.equal(records.panners.length,1);assert.equal(node.gain.gain.value,0.5);
 });
 await check('zero pan connects directly and does not allocate a panner',async()=>{
  const track=asset('center'),{audio,records}=output();await audio.prepare([project('se:1',track)]);audio.project([project('se:1',track)],true);
  assert.equal(records.panners.length,0);assert.deepEqual(audio.nodes.get('se:1').gain.connections,[audio.master]);
 });
 await check('late decode after reset cannot create nodes, advance or repopulate current core state',async()=>{
  const track=asset('late'),{audio,context}=output(),state=new FieldSoundState(),m=media({1:track});state.play(play(),m);
  const before=state.snapshot();let finish,started;const began=new Promise(resolve=>started=resolve);
  context.decodeAudioData=()=>new Promise(resolve=>{finish=resolve;started();});
  assert.equal(audio.ready([{...project('se:1',track),voice:state.voices[0]}]),false);
  await began;audio.reset();const current=new FieldSoundState(),currentBefore=current.snapshot();
  finish({numberOfChannels:2,duration:1,sampleRate:1000});await audio.pending.get(track.sha256);
  assert.equal(audio.nodes.size,0);assert.deepEqual(state.snapshot(),before);assert.deepEqual(current.snapshot(),currentBefore);assert.equal(audio.isReady(track),true);
 });
 await check('new dependency preparation failure is reported without stopping existing SE',async()=>{
  const track=asset('current'),failed=asset('bad'),{audio}=output(),projection=project('se:1',track);
  await audio.prepare([projection]);audio.project([projection],true);const current=audio.nodes.get('se:1');
  const goodFetch=globalThis.fetch;globalThis.fetch=async url=>url===failed.file?response(Buffer.from('bad')):goodFetch(url);
  try{await assert.rejects(audio.prepare([projection],[failed]),/摘要不匹配/);}finally{globalThis.fetch=goodFetch;}
  assert.throws(()=>audio.ready([projection],[failed]),/摘要不匹配/);assert.equal(audio.ready([projection]),true);audio.project([projection],true);
  assert.equal(audio.nodes.get('se:1'),current);assert.equal(current.source.stops,0);
 });
 await check('pause and resume preserve each SE node; reset disconnects every source, gain and panner',async()=>{
  const track=asset('pause'),{audio,records,context}=output(),projections=[project('se:1',track,{pan:-0.4}),project('se:2',track,{pan:0.8})];
  await audio.prepare(projections);audio.project(projections,true);const nodes=[...audio.nodes.values()];audio.project(projections,false);assert.equal(records.suspends,1);assert.equal(records.sources.length,2);
  assert.deepEqual([...audio.nodes.values()],nodes);context.currentTime=0;audio.project(projections,true);assert.equal(records.resumes,2);assert.equal(records.sources.length,2);
  audio.reset();assert.equal(audio.nodes.size,0);for(const n of nodes){assert.equal(n.source.stops,1);assert.equal(n.source.disconnects,1);assert.equal(n.gain.disconnects,1);assert.equal(n.pan.disconnects,1);}
 });
 await check('active SE decodes survive inactive cache eviction together with pending dependencies',async()=>{
  const active=asset('cache-active'),dependency=asset('cache-needed'),idle=[asset('cache-idle-a'),asset('cache-idle-b'),asset('cache-idle-c')],{audio}=output(),projection=project('se:3',active);
  await audio.prepare([projection],[dependency,...idle]);audio.project([projection],true,[dependency]);assert.equal(audio.buffers.has(active.sha256),true);assert.equal(audio.buffers.has(dependency.sha256),true);
  assert.equal(audio.buffers.size,4);assert.equal(audio.buffers.has(idle[0].sha256),false);assert.equal(audio.nodes.size,1);
 });
 await check('drift replacement and natural removal disconnect SE panners as well as sources',async()=>{
  const track=asset('drift',{loop:{start:0,end:1000}}),{audio,records}=output(),projection=project('se:4',track,{pan:0.5});await audio.prepare([projection]);audio.project([projection],true);const first=audio.nodes.get('se:4');
  audio.project([{...projection,time:200}],true);assert.equal(first.source.stops,1);assert.equal(first.pan.disconnects,1);assert.equal(records.sources.length,2);
  const second=audio.nodes.get('se:4');audio.project([],true);assert.equal(second.source.stops,1);assert.equal(second.pan.disconnects,1);assert.equal(audio.nodes.size,0);
 });
 await check('short SE reproduces the old loss and presentation acknowledgment preserves its first output',async()=>{
  const track=asset('short',{frames:20}),m=media({1:track}),state=new FieldSoundState(),{audio,records}=output();state.play(play(),m);
  const field={se:state,content:{se:m}},before=state.snapshot();await audio.prepare(audioProjection(field));assert.deepEqual(state.snapshot(),before);
  // Reproduce the old host ordering explicitly: decode-ready -> advance -> project.
  state.advance(50,m);audio.project(audioProjection(field),true);assert.equal(records.sources.length,0);
  // Decode readiness alone cannot authorize time. The real presentation API
  // observes a node created by the post-simulation projection; no callback
  // edits the owner or fabricates a played signal.
  assert.equal(typeof audio.isSoundPresented,'function');
  const fresh=new FieldSoundState();fresh.play(play(),m);const next={se:fresh,content:{se:m}},snapshot=fresh.snapshot();
  const presented=()=>fresh.voices.every(v=>audio.isReady(track)&&audio.isSoundPresented(v,track));
  assert.equal(presented(),false);
  if(presented())fresh.advance(50,m);
  assert.deepEqual(fresh.snapshot(),snapshot);assert.equal(records.sources.length,0);
  audio.project(audioProjection(next),true);assert.equal(presented(),true);
  assert.equal(records.sources.length,1);assert.equal(records.sources[0].starts[0][1],0);
  assert.deepEqual(fresh.snapshot(),snapshot,'AudioOutput publication cannot advance core');
  // Subsequent frame: it is now safe for the owner to reach completion.
  if(presented())fresh.advance(50,m);
  audio.project(audioProjection(next),true);assert.equal(records.sources[0].stops,1);
  assert.equal(audio.isSoundPresented(snapshot.voices[0],track),false);

 });
 await check('SE presentation acknowledgment requires full voice identity and cannot borrow BGM nodes',async()=>{
  const track=asset('ack'),other=asset('ack-other'),{audio,records}=output(),base=voice(7,1,{pan:0.4});
  const before=fetches;assert.equal(audio.isSoundPresented(base,track),false);assert.equal(fetches,before);assert.equal(audio.pending.size,0);
  await audio.prepare([project('bgm:7',track)]);audio.project([{id:'bgm:7',track,voice:base,time:0}],true);
  assert.equal(audio.isSoundPresented(base,track),false);
  audio.project([{id:'se:7',track,voice:base,time:0}],true);assert.equal(audio.isSoundPresented(base,track),true);
  for(const change of [{id:8},{track:2},{started:1},{seek:0.01},{fadeIn:1},{pan:-0.4}])
   assert.equal(audio.isSoundPresented({...base,...change},track),false,JSON.stringify(change));
  assert.equal(audio.isSoundPresented(base,other),false);
  audio.project([{id:'se:7',track,voice:base,time:0}],false);assert.equal(records.suspends,1);
  audio.reset();assert.equal(audio.isSoundPresented(base,track),false);
 });

}finally{globalThis.fetch=originalFetch;}
const report={formatVersion:1,kind:'controlled-field-sound-ui-check',audioModuleSha256:sha(source),staticAudioModuleSha256:sha(await readFile(resolve(compiled,'src/core/static-audio.js'))),fieldSoundModuleSha256:sha(await readFile(resolve(compiled,'src/core/field-sound.js'))),tests,limitations:['Actual AudioOutput/audioProjection with controlled fetch and WebAudio; no browser, decoder or audio-device acceptance','Short-voice readiness is checked using the actual read-only AudioOutput acknowledgment; app/frame and core host wiring require separate integration checks','Controlled presentation acknowledgment verifies node creation and identity, not actual sound-card playback','SE lifecycle and fade remain explicit Web adapters, not native mixer equivalence']};
const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(outputPath,bytes);console.log(JSON.stringify({result:'pass',tests:tests.length,reportSha256:sha(bytes),reportPath:outputPath}));
