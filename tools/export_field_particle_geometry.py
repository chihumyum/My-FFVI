"""Export the exact field particle board material and its two shader passes.

This dependency export neither generates billboards nor admits a particle
emitter. Original shader bytes are written only below the ignored output path.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'source_adapter'))
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, source_ref, write_json
from export_field_effect_media import preserve_ids


def export_geometry(source: Path, output: Path):
    import UnityPy
    from UnityPy.export.ShaderConverter import ShaderProgram
    from UnityPy.helpers import CompressionHelper
    from UnityPy.streams import EndianBinaryReader
    corpus = json.loads(checked_snapshot(REPO / 'build/corpus')['corpus.json'])
    if hashlib.sha256(canonical(corpus['sources']).encode()).hexdigest() != corpus['sourceSetHash']:
        raise ValueError('Changed corpus source manifest')
    assets, selected, paths = {}, {}, {}
    for group in ['chara_field', 'map_common']:
        entries = [s for s in corpus['sources'] if Path(s['file']).name.startswith(group + '_assets_all_')]
        if len(entries) != 1 or digest(source / entries[0]['file']) != entries[0]['sha256']:
            raise ValueError('Missing or changed field board source')
        item = entries[0]; selected[item['file']] = item
        env = UnityPy.load(str(source / item['file']))
        for asset in env.assets:
            if asset.name in assets or asset.unity_version != '2019.4.20f1':
                raise ValueError('Unexpected field board serialized identity')
            assets[asset.name] = (asset, item['file'])
        for path, pointer in env.container.items():
            obj = pointer.deref(); paths[(obj.assets_file.name, str(obj.path_id))] = path
    def reference(obj, path=None):
        cab = obj.assets_file.name; file = assets[cab][1]
        path = path or paths.get((cab, str(obj.path_id)))
        if path is None:
            raise ValueError('Unbound source board object path')
        return {**source_ref(file, path, obj), 'serializedFile': cab, 'sha256': selected[file]['sha256']}
    def resolve(obj, pointer, expected):
        cab = obj.assets_file.name
        if pointer['m_FileID']:
            cab = obj.assets_file.externals[pointer['m_FileID'] - 1].path.split('/')[-1]
        if cab not in assets or pointer['m_PathID'] == 0:
            raise ValueError('Unbound board dependency pointer')
        result = assets[cab][0].objects[pointer['m_PathID']]
        if result.type.name != expected:
            raise ValueError('Board dependency type mismatch')
        return result
    components = []
    for asset, _ in assets.values():
        for obj in asset.objects.values():
            if obj.type.name == 'MonoBehaviour':
                tree = obj.read_typetree()
                if 'originalEffectMaterial' in tree:
                    components.append((obj, tree))
    if len(components) != 1:
        raise ValueError('Ambiguous field particle entity material owner')
    component, tree = components[0]
    game_object = resolve(component, tree['m_GameObject'], 'GameObject')
    component_path = paths.get((game_object.assets_file.name, str(game_object.path_id)))
    material = resolve(component, tree['originalEffectMaterial'], 'Material')
    mat = material.read_typetree()
    shader = resolve(material, mat['m_Shader'], 'Shader')
    shader_data, shader_tree = shader.read(), shader.read_typetree()
    if shader_data.platforms != [4] or len(shader_tree['m_ParsedForm']['m_SubShaders']) != 1:
        raise ValueError('Unimplemented field board shader platform/subshader')
    start = shader_data.offsets[0][0]
    blob = CompressionHelper.decompress_lz4(bytes(shader_data.compressedBlob)[start:start + shader_data.compressedLengths[0][0]],
                                           shader_data.decompressedLengths[0][0])
    programs = ShaderProgram(EndianBinaryReader(blob, endian='<'), shader.version)
    output.mkdir(parents=True, exist_ok=True); (output / 'shaders').mkdir(exist_ok=True)
    passes = []
    for pas in shader_tree['m_ParsedForm']['m_SubShaders'][0]['m_Passes']:
        stages = {}
        for name in ['progVertex', 'progFragment']:
            variants = pas[name]['m_SubPrograms']
            if len(variants) != 1 or variants[0]['m_GlobalKeywordIndices'] or variants[0]['m_LocalKeywordIndices']:
                raise ValueError('Unknown field board shader keyword selection')
            sub = variants[0]; index = sub['m_BlobIndex']; code = bytes(programs.m_SubPrograms[index].m_ProgramCode)
            code = code[code.index(b'DXBC'):]
            sha = hashlib.sha256(code).hexdigest(); file = 'shaders/' + sha + '.dxbc'
            (output / file).write_bytes(code)
            stages[name] = {'index': index, 'sha256': sha, 'file': file, 'parameters': preserve_ids(sub)}
        passes.append({'programs': stages, 'state': preserve_ids(pas['m_State']), 'names': pas['m_NameIndices']})
    sources = sorted(selected.values(), key=lambda s: s['file'])
    for item in sources:
        if digest(source / item['file']) != item['sha256']:
            raise ValueError('Field board source changed during export')
    result = {'formatVersion': 1, 'adapterVersion': 'field-particle-geometry-0.1.0',
        'parentSourceSetHash': corpus['sourceSetHash'], 'sources': sources,
        'sourceSetHash': hashlib.sha256(canonical(sources).encode()).hexdigest(),
        'particleEntity': {'source': reference(component, component_path), 'data': preserve_ids(tree),
            'externals': [x.path for x in component.assets_file.externals]},
        'material': {'source': reference(material), 'data': preserve_ids(mat),
            'externals': [x.path for x in material.assets_file.externals]},
        'shader': {'source': reference(shader), 'name': shader_tree['m_ParsedForm']['m_Name'], 'passes': passes}}
    write_json(output / 'geometry.json', result)
    write_json(output / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(output).as_posix(), 'sha256': digest(p)}
        for p in sorted(output.rglob('*')) if p.is_file() and p.name != 'snapshot.json']})
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = export_geometry(args.source.resolve(), args.output.resolve())
    print(canonical({'sourceSetHash': result['sourceSetHash'], 'passes': len(result['shader']['passes'])}))
