"""Recheck only the existing ordinary v33 vertex/pixel alpha inputs, not new shaders."""
import json,hashlib,struct,argparse
from pathlib import Path
import UnityPy
from UnityPy.export.ShaderConverter import ShaderProgram
from UnityPy.helpers import CompressionHelper
from UnityPy.streams import EndianBinaryReader
parser=argparse.ArgumentParser();parser.add_argument('--root',default='.');parser.add_argument('--output',default='build/reports/field-visibility-native');args=parser.parse_args();root=Path(args.root).resolve();out=(root/args.output).resolve();out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((root/'build/corpus/corpus.json').read_text())
file='FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle'
source=next(s for s in manifest['sources'] if s['file']==file);data=(root/'build/runtime/game'/file).read_bytes()
assert len(data)==source['bytes']==59904
assert hashlib.sha256(data).hexdigest()==source['sha256']=='82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa'
env=UnityPy.load(data);reader=next(o for o in env.objects if o.path_id==-2780621064449857182)
shader=reader.read();tree=reader.read_typetree();assert shader.platforms==[4]
blob=CompressionHelper.decompress_lz4(bytes(shader.compressedBlob)[shader.offsets[0][0]:shader.offsets[0][0]+shader.compressedLengths[0][0]],shader.decompressedLengths[0][0])
program=ShaderProgram(EndianBinaryReader(blob,endian='<'),reader.version)
parsed=tree['m_ParsedForm']['m_SubShaders'][0]['m_Passes'][0];names={v:k for k,v in parsed['m_NameIndices']}
expected={0:'7ed9833b38c5400251f51c35af5885e3c8a7e51585043a386e11038085ea2213',8:'c4ea6d1f7cdcde41abb5aa08657932cd4421025903aa4ec20f42c004ea8ca414'}
word_rows={0:{188:[0x8000038,0x1020f2,0x2,0x101e46,0x2,0x208e46,0,4]},8:{94:[0x8000038,0x1000f2,0,0x100e46,0,0x208e46,0,4],102:[0x7000038,0x100082,0,0x10003a,0,0x10103a,2]}}
texts={0:{188:'mul o2.xyzw, v2.xyzw, cb0[4].xyzw'},8:{94:'mul r0.xyzw, r0.xyzw, cb0[4].xyzw',102:'mul r0.w, r0.w, v2.w'}}
rows=[]
for index,stage in [(0,'progVertex'),(8,'progFragment')]:
 sub=program.m_SubPrograms[index];b=bytes(sub.m_ProgramCode);b=b[b.index(b'DXBC'):]
 digest=hashlib.sha256(b).hexdigest();assert digest==expected[index];assert sub.m_Keywords==[]
 u=lambda p:struct.unpack_from('<I',b,p)[0]
 assert u(24)==len(b)
 chunks={b[o:o+4].decode():b[o+8:o+8+u(o+4)] for o in [u(32+4*i)for i in range(u(28))]}
 code=chunks['SHDR'];words=list(struct.unpack('<'+'I'*(len(code)//4),code));selected=[]
 for off,wanted in word_rows[index].items():
  assert words[off:off+len(wanted)]==wanted
  selected.append({'wordOffset':off,'words':[hex(w)for w in wanted],'reviewedInstruction':texts[index][off]})
 entry=parsed[stage]['m_SubPrograms'][0];assert entry['m_BlobIndex']==index
 bindings=entry['m_ConstantBufferBindings'];globals_binding=next(x for x in bindings if names[x['m_NameIndex']]=='$Globals')
 assert globals_binding['m_Index']==0
 globals_buffer=next(x for x in entry['m_ConstantBuffers'] if names[x['m_NameIndex']]=='$Globals')
 color=next(x for x in globals_buffer['m_VectorParams'] if names[x['m_NameIndex']]=='_Color')
 assert color['m_Index']==64 and color['m_Dim']==4
 def signature(chunk):
  block=chunks[chunk];n=struct.unpack_from('<I',block)[0];values=[]
  for j in range(n):
   off,ix,system,typ,reg=struct.unpack_from('<IIIII',block,8+j*24)
   name=block[off:block.index(0,off)].decode();values.append({'name':name,'semanticIndex':ix,'system':system,'type':typ,'register':reg,'mask':block[8+j*24+20]})
  return values
 sig=signature('OSGN'if index==0 else'ISGN');color_sig=next(x for x in sig if x['register']==2)
 assert color_sig['name'].upper()=='COLOR' and color_sig['semanticIndex']==0 and color_sig['mask']==15
 rows.append({'stage':stage,'index':index,'sha256':digest,'size':len(b),'colorBinding':{'constantBuffer':0,'vector':4,'byteOffset':64,'name':'_Color'},'colorSignature':color_sig,'instructions':selected})
materials=[]
for reader in env.objects:
 if reader.path_id in [-7174982382500632610,3801139012394849710]:
  m=reader.read_typetree();props=m['m_SavedProperties'];colors=dict(props['m_Colors']);floats=dict(props['m_Floats'])
  assert colors['_Color']=={'r':1.0,'g':1.0,'b':1.0,'a':1.0}
  assert floats['_ConversionSemiTransparentAlpha']==1 and floats['_BlendScale']==1
  assert floats['_SrcBlend']==1 and floats['_DstBlend']==0 and floats['_ZWrite']==1
  materials.append({'objectId':str(reader.path_id),'shaderObjectId':str(m['m_Shader']['m_PathID']),'colors':colors,'floats':floats})
assert len(materials)==2
report={'kind':'source-ordinary-visibility-alpha-shader-inputs-v1','result':'passed-static-input-binding','sourceSetHash':manifest['sourceSetHash'],'parentSourceSetHash':manifest['parentSourceSetHash'],'source':source,'shaderObjectId':str(-2780621064449857182),'programs':rows,'materials':materials,'interpretation':{'vertexAlpha':'float32(frameAlpha * materialColorAlpha)','pixelAlphaBeforeHeadOverlays':'float32(float32(textureAlpha * materialColorAlpha) * vertexAlpha)','materialAlphaOccurrences':2,'depthWrite':'materialFadeAlpha >= 1 independently of animation frame alpha','headOverlayOrdering':'Apply the two known source RT RGBA lerps after the initial texture/material/vertex-alpha product; do not multiply the final head alpha by fade again.'},'semanticsVerified':False,'gpuExecuted':False,'originalGameExecuted':False}
assert hashlib.sha256((root/'build/runtime/game'/file).read_bytes()).hexdigest()==source['sha256']
(out/'shader-alpha-inputs.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'result':report['result'],'programs':len(rows),'materials':len(materials),'materialAlphaOccurrences':2}))
