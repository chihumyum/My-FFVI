"""Pinned complete-range static handoff audit. Does not execute or export native code."""
import argparse, hashlib, json, sys
from pathlib import Path
import capstone
PINS = {'native': '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc', 'symbols': '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3', 'header': '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'}
METHODS = [(2652624, 2653456, 'a178d9e2c13a5faad83d6eb9c1d2ab46d33a57a32a476c75f727fd59a2874bb1', 'bfc0ac14f489383e600edcca1a559147104609852e80d28b20c4174813abd3c4', 'methods'), (2674656, 2674864, 'f779a7ab834b5de16086120cbe66169abd8ddaa2d3c0ece5fb0fb1abfac1314b', '6984bfe7af675e487e012bf90bd1d73ad96dd5678fd49c978f776e2aed72c150', 'methods'), (2691920, 2692896, 'dbabbbcc557e34db90bdaba2e8a2cf7608b23dfd11d08ef90e62c95a169b4b17', '09f6eaaab229449518aafabadd9d2800b0afcfebaecefdef2d3eb9cb7044104a', 'methods'), (2696416, 2697360, '5626d4d92790d234278da9d23c6947943d5dd08ceb4ffdac75db8dbb2f4c1805', '10bf2da74b611237840c6fcc5e3e109b2a59ed26025ee440b8fabc36390cf107', 'methods'), (2732384, 2733104, 'ba2a0ae16b25b11c53767f2d74de074900494f450485a2dd9fc1a50a5355e789', 'e626df836b247abde8894d2dcf8d0da7447636eafd6d0f8b8fd2f94aab7e1129', 'methods'), (6271600, 6271664, 'c047b927010a1afd62ab7115908c42621adc51605210632c47a2352e5ae8e379', '0b04252d398b2a66198d7635c17eb9888f43debdcec8a9f52ba588c56c625e28', 'methods'), (6274080, 6274704, '04757f83033a8c3bdd2906d4b78600c80ae4f2320078d31881e9b38e985b38ea', '2ab4c7a16bc0b043714311b1814dbc86fd43682af33315b3c62a567863bccef4', 'methods'), (6275056, 6275600, '26b816af9745792d07a272790f4ba6ee36535a26c4d0d4c4b5e9df4db7914fd2', 'b627b9f389126b511a8ff2bc26e42c758a6d4c88f9a998cc2d481f54a61984df', 'methods'), (6438832, 6440096, '334d3e73abb39615bb17dbd4536d2379a3da14a9f88d816da3c2ef492954cc0c', '693a16e9ca64a51e7194c9c532dc97e2d2b1e49651886d0f30fd9c8ed9a15f21', 'ui'), (6440096, 6440608, '686cf0a3954512d4d6bfc9717e0f1e82bc746d0b4cbef4a652b68f82fc97578c', 'd06398e29527de719fba9dc2700a1fa810d49e7ea7ac66f30a1cfad987427483', 'ui'), (7311088, 7312528, '74ed9ddf83466bcf5b549273dd5a2ed142ed588a8cccd9636f8df250af0a1b28', '0e9745b9362c444f27b7de9686e877b00088ebd03a251aca822c18082fbb1831', 'ui'), (7332704, 7332848, 'fea6a541609755f1aeaf8a5d7743671d7d0d10e872aa0f0cf2198913e8f07fbc', 'de06677ba6819ee049fa8aac3cbf5150350ca26cb3febd9d2734d07ad6d27e21', 'ui'), (7335456, 7336272, '9352b7c439585bdd0bc8f5b49275e6a7bd7f7f2b81b2966cf4daf85d558c0052', '3b502712c74de06f2e8c261f2ee74d2c73d454967c6967e9370c9dbc5b22ddce', 'ui'), (8387376, 8388656, 'c429ccdadb9995e544ad031353d526f696db5f1bfc8c153ef8cd42aa92ce8cbf', 'c94bcb039c25f65146f5f521bfdfeb0e3cd27062c9d47cd75649d80bc054a0d0', 'ui'), (8390240, 8390832, 'b448de47458e70beccb037127f2b8d9ea6fb847b5c0161073b1d9e85a40c26ff', '7a7e01197ddea0867e9887f2b316cf6f0bad50455db17e12f3336435b42f4940', 'ui'), (8403520, 8405232, '8e3d141ead50747219ff753bbec57eab941e1f55dd5671876df3f0714d906b45', '8f6068ffda55175400b0c21012ed4cce5ed9035008e48a4e3008f4ae6b8a642e', 'ui'), (2536576, 2542032, '73bfd96963e34ea2224ae4c2677071b068dd8ad51faf8acbd32dda38c5e68939', 'be107b7c54d433f1aefd7bdda97b09fd83e7e657784aa1f57b6b29c8b005004f', 'player')]
PE_ONLY = [0x5a0ae0, 0x6fd340, 0x6fde40, 0x398920, 0x5b57d0, 0x4a4a40, 0x4a5f30, 0x491610, 0x52ffc0, 0x626790]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
p.add_argument('--methods-cache',type=Path,default=Path('build/native/source-battle-final-menu-handoffs-v1/methods'))
p.add_argument('--ui-cache',type=Path,default=Path('build/native/source-battle-final-menu-handoffs-v1/ui'))
p.add_argument('--player-cache',type=Path,default=Path('build/native/v57-player-switch'))
p.add_argument('--output',type=Path,default=Path('build/reports/source-battle-handoffs-native.json'))
a=p.parse_args();root=a.root.resolve();out=(root/a.output).resolve();assert out.is_relative_to(root/'build')
sha=lambda b:hashlib.sha256(b).hexdigest()
paths={'native':'build/runtime/game/GameAssembly.dll','symbols':'build/native/il2cpp/script.json','header':'build/native/il2cpp/il2cpp_ghidra.h'}
buffers={k:(root/path).read_bytes() for k,path in paths.items()};assert {k:sha(v)for k,v in buffers.items()}==PINS
sys.path.insert(0,str(root));from tools.native.inspect_pe import PEImage
image=PEImage(buffers['native']);metadata=json.loads(buffers['symbols']);symbols=metadata['ScriptMethod'];addresses=sorted({m['Address']for m in symbols})
method_refs={m['Address']:m for m in metadata['ScriptMetadataMethod']}
decoder=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);decoder.detail=True
rows=[];caches={'methods':(root/a.methods_cache).resolve(),'ui':(root/a.ui_cache).resolve(),'player':(root/a.player_cache).resolve()};receipts={}
for scope,cache in caches.items():
 receipt_bytes=(cache/'complete.json').read_bytes();receipt=json.loads(receipt_bytes);assert receipt['status']=='complete'
 for k,v in PINS.items():assert receipt[k+'Sha256']==v
 receipts[scope]={'file':str(cache/'complete.json'),'sha256':sha(receipt_bytes),'data':receipt}
expected={r[0]:r for r in METHODS}
for start in sorted(set(expected)|set(PE_ONLY)):
 end=next(v for v in addresses if v>start);section,offset,raw=image.read(start,end-start);ops=list(decoder.disasm(raw,start));assert sum(op.size for op in ops)==len(raw)
 row={'rva':hex(start),'nextSymbolRva':hex(end),'bytes':len(raw),'nativeRangeSha256':sha(raw),'rawHex':raw.hex(),'section':section,'fileOffset':offset,'aliases':[m for m in symbols if m['Address']==start],
  'disassembly':[{'rva':hex(o.address),'mnemonic':o.mnemonic,'operands':o.op_str}for o in ops], 'metadataReferences':[],
  'calls':[{'at':hex(o.address),'target':hex(o.operands[0].imm)} for o in ops if o.mnemonic in ['call','jmp']and o.operands[0].type==capstone.x86.X86_OP_IMM]}
 for op in ops:
  for operand in op.operands:
   if operand.type==capstone.x86.X86_OP_MEM and operand.mem.base==capstone.x86.X86_REG_RIP:
    address=op.address+op.size+operand.mem.disp
    if address in method_refs:row['metadataReferences'].append({'at':hex(op.address),'address':hex(address),'method':method_refs[address]})
 if start in expected:
  _,bound,raw_sha,c_sha,scope=expected[start];assert end==bound and sha(raw)==raw_sha
  content=(caches[scope]/(format(start,'x')+'.c')).read_bytes();assert sha(content)==c_sha
  receipts_for_method=[m for m in receipts[scope]['data']['methods']if int(m['rva'],16)==start];assert len(receipts_for_method)==1
  record=receipts_for_method[0];assert record['nextSymbolRva']==hex(end)and record['nativeRangeSha256']==raw_sha and record['decompiledSha256']==c_sha
  row['decompiled']={'file':str(caches[scope]/(format(start,'x')+'.c')),'sha256':c_sha,'bytes':len(content)}
 rows.append(row)
by={int(row['rva'],16):row for row in rows}
assert any(r['method']['MethodAddress']==0x5a0ae0 and '<RecoveryColosseum>' in r['method']['Name']for r in by[0x5fbff0]['metadataReferences'])
assert any(m['Name']=='Last.Data.Master.Condition$$get_ConditionType' for m in by[0x4a4a40]['aliases'])
assert any(m['Name']=='Last.Data.Master.Condition$$get_UntilType' for m in by[0x4a5f30]['aliases'])
assert any(c['target']=='0x4a4a40' for c in by[0x5a0ae0]['calls'])
assert any(o['mnemonic']=='cmp' and o['operands']=='eax, 0x259' for o in by[0x5a0ae0]['disassembly'])
for getter in [0x4a5f30,0x4a4a40,0x52ffc0]:assert any(c['target']==hex(getter)for c in by[0x2924e0]['calls'])
for start in [0x6fd340,0x6fde40]:
 row=by[start];assert len([c for c in row['calls']if c['target']=='0x623fb0'])==2
 assert any(o['mnemonic']=='cmp' and o['operands']=='byte ptr [rbx + 0xb0], 0'for o in row['disassembly'])
 assert any(o['mnemonic']=='mov'and o['operands']=='dword ptr [rbx + 0x18], 0xc'for o in row['disassembly'])
 assert any(o['mnemonic']=='lea'and o['operands']=='edx, [r8 + 1]'for o in row['disassembly'])
for start in [0x398920,0x5b57d0]:assert any(c['target']=='0x52ffc0' for c in by[start]['calls'])
assert by[0x626790]['rawHex'].startswith('85d20f94c0c3')
assert {k:sha((root/path).read_bytes())for k,path in paths.items()}==PINS
report={'kind':'source-battle-handoffs-native-static-v1','result':'passed','identity':PINS,'inputs':paths,'receipts':receipts,'methods':rows,
 'counts':{'completeCMethods':len(METHODS),'completeCNativeBytes':sum(end-start for start,end,*_ in METHODS),'PEOnlyMethods':len(PE_ONLY),'completeNativeMethods':len(rows),'completeNativeBytes':sum(row['bytes']for row in rows)},
 'scope':{'originalGameExecuted':False,'nativeExportedByChecker':False,'nativeSemanticsRuntimeVerified':False,'shared601PredicateExported':False,
  'newExportPackets':'8 methods / 4912 B and 8 UI methods / 7760 B; earlier nine-method script failure is not a completed packet',
  'sourceFinalFlag3Result':'explicit independent gate','source0055Non607FieldAdd':'explicit independent gate','colosseumStart':'actual bet/opponent/automatic-battle/settlement remains gated'}}
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['counts']))
