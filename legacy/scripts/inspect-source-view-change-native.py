"""Verify complete sealed ChangeView bodies/raw getters; not native execution."""
import argparse,bisect,hashlib,json,sys
from pathlib import Path
PINS={'native':'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc','symbols':'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3','header':'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718','metadata':'9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45','dump':'e02150228dc4071d4ca6402a14827e7fd652fa0a4a072546b513c91b016a443b'}
BODIES={
 'b50080':('ac1c27a022b91128da12e8b5a16fbd78771d67702be92b9ea6bec7e59fa11d41','5e7e2f78fad7d6ee501b30f32f6cd246ee8ae02d39b380522cb004f9bc0b738f','Last.Interpreter.Instructions.External.Misc$$ChangeView'),
 '2d4b70':('a75c305ccbb2de592a2130d88004e81bca7e158216055876f69d024e47641c4e','d480f8c076156339d460c9de517fbee00262aaa5475eb8a5e91ab4811ee850b1','Last.Map.FieldController$$ChangeViewBird'),
 '9d9d10':('9a958a3cf51aaa243cebd2aebea1ccf2332a2966b43a402af3f695adb5cb18c8','30ecef9d86d5edac2513af72080ed80e5a8dc457375242c27171a54868ab89c4','Last.Map.BirdViewController$$RemoveMoveCallback'),
 '2d5f90':('801237dd9ca61d40a2a458aae52ad6b15edf27954c93059bb36e05df45656483','2a7815b100b671708e69700dfd318ce178f074476d0bf8d851387901f25cf5c7','Last.Map.FieldController$$ChangeView'),
 '2d5880':('afdd1eb167c57f0e3f1521b18aea752b05429f5b3cc344eb20c51e3aa8455f65','d8eb1e402927ec328ef0324f6e61efd38e519304e596893a826517406ab4f5dd','Last.Map.FieldController$$ChangeViewNormal'),
 '9db350':('41ee5a44881efcefcf51544f9eb4814a711b38b4cadf13f1f6bbdf0e401ab4fc','5a05e16d8f86d6ad485c4130f88b714164ccec56871b24e7016f69fb496d6639','Last.Map.BirdViewController$$SetMoveCallback')}
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--cache',type=Path,default=Path('build/native/source-view-change-v1'));p.add_argument('--output',type=Path,default=Path('build/reports/source-view-change-native.json'));a=p.parse_args();root=a.root.resolve();cache=(root/a.cache).resolve();out=(root/a.output).resolve();assert out.is_relative_to(root/'build');out.parent.mkdir(parents=True,exist_ok=True)
report={'kind':'source-view-change-native-static-v1','result':'running','nativeExecuted':False,'nativeParity':False}
sha=lambda b:hashlib.sha256(b).hexdigest()
try:
 paths={'native':'build/runtime/game/GameAssembly.dll','symbols':'build/native/il2cpp/script.json','header':'build/native/il2cpp/il2cpp_ghidra.h','metadata':'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat','dump':'build/native/il2cpp/dump.cs'}
 buffers={k:(root/v).read_bytes() for k,v in paths.items()};assert {k:sha(v)for k,v in buffers.items()}==PINS,'Native research inputs drifted'
 sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
 image=PEImage(buffers['native']);symbols=json.loads(buffers['symbols']);methods=symbols['ScriptMethod'];addresses=sorted({m['Address']for m in methods});rows=[]
 getters=json.loads((cache/'wait-getter-raw.json').read_bytes());manifest=json.loads((cache/'manifest.json').read_bytes());inputs=[]
 for row in manifest['files']:
  b=(cache/row['file']).read_bytes();assert len(b)==row['bytes'] and sha(b)==row['sha256'],'Cache body changed: '+row['file'];inputs.append(row)
 for start in sorted({int(k,16)for k in BODIES}|{int(row['rva'],16)for row in getters}|{0x2c8ef0}):
  end=addresses[bisect.bisect_right(addresses,start)];section,offset,raw=image.read(start,end-start)
  names=[m for m in methods if m['Address']==start];row={'rva':hex(start),'endRva':hex(end),'bytes':len(raw),'sha256':sha(raw),'rawHex':raw.hex(),'symbols':names};key=format(start,'x')
  if key in BODIES:
   ch,rh,name=BODIES[key];b=(cache/(key+'.c')).read_bytes();assert sha(b)==ch and sha(raw)==rh,'Sealed complete body mismatch: '+key
   assert any(m['Name']==name for m in names),'Method type/name mismatch: '+name
   row['decompiledC']={'file':key+'.c','sha256':ch,'bytes':len(b)}
  expected=next((r for r in getters if int(r['rva'],16)==start),None)
  if expected:assert raw.hex()==expected['rawHex'] and sha(raw)==expected['sha256'],'Raw getter mismatch'
  if start==0x2c8ef0:assert raw.startswith(bytes.fromhex('c20000')),'AirShipFollowing callback body changed'
  rows.append(row)
 assert {k:sha((root/v).read_bytes())for k,v in paths.items()}==PINS
 report.update(result='passed',identity=PINS,inputs=inputs,methods=rows,counts={'completeRawMethods':len(rows),'rawBytes':sum(r['bytes']for r in rows),'completeC':len(BODIES)},
  scope='MainCore wrapper, Normal/Bird branches, nonempty callback registration/removal wrappers and wait getter. Web flat walking is an explicit different controller; takeoff/airship/material registration and all MoveBirdView semantics remain unresolved.',newExports=0)
except Exception as error:
 report.update(result='failed',error={'type':type(error).__name__,'message':str(error)})
 out.write_text(json.dumps(report,indent=2)+'\n');raise
out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['counts']))
