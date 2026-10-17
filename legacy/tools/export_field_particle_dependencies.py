"""Resolve the exact shaders/textures referenced by exported field EffectPrefabs.

This is a source-bound dependency export, not particle simulation admission.
Only explicitly selected locked bundles are opened. PPtr identities stay strings.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'source_adapter'))
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, source_ref, write_json
from export_field_effect_media import preserve_ids


def export_dependencies(source: Path, media_path: Path, groups: list[str], out: Path):
    import UnityPy
    from UnityPy.export.ShaderConverter import ShaderProgram
    from UnityPy.helpers import CompressionHelper
    from UnityPy.export.Texture2DConverter import get_image_from_texture2d
    from UnityPy.streams import EndianBinaryReader
    manifest = json.loads(checked_snapshot(REPO / 'build/corpus')['corpus.json'])
    if hashlib.sha256(canonical(manifest['sources']).encode()).hexdigest() != manifest['sourceSetHash']:
        raise ValueError('Corpus manifest changed')
    media_bytes = media_path.read_bytes()
    media = json.loads(media_bytes)
    if media['parentSourceSetHash'] != manifest['sourceSetHash']:
        raise ValueError('Effect media belongs to another source set')
    by_file = {s['file']: s for s in manifest['sources']}
    selected = {s['file']: s for s in media['sources']}
    for file, item in selected.items():
        if by_file.get(file) != item or digest(source / file) != item['sha256']:
            raise ValueError('Changed effect media source: ' + file)
    assets = {}; paths = {}
    if not groups or len(groups) != len(set(groups)):
        raise ValueError('Expected explicit unique dependency bundle groups')
    for group in groups:
        candidates = [s for s in manifest['sources'] if Path(s['file']).name.startswith(group + '_assets_all_')]
        if len(candidates) != 1:
            raise ValueError('Missing/ambiguous dependency bundle ' + group)
        item = candidates[0]; file = item['file']
        if digest(source / file) != item['sha256']:
            raise ValueError('Changed particle dependency source')
        selected[file] = item
        env = UnityPy.load(str(source / file))
        for asset in env.assets:
            if asset.name in assets:
                raise ValueError('Ambiguous serialized file')
            if asset.unity_version != '2019.4.20f1':
                raise ValueError('Unexpected serialized Unity version')
            assets[asset.name] = (asset, file)
        for path, pointer in env.container.items():
            obj = pointer.deref()
            key = (obj.assets_file.name, str(obj.path_id))
            if key in paths and paths[key] != path:
                raise ValueError('Ambiguous dependency asset path')
            paths[key] = path
    def resolve(group, pointer, expected):
        fid, oid = pointer['m_FileID'], pointer['m_PathID']
        if not isinstance(oid, str) or fid <= 0 or oid == '0':
            raise ValueError('Expected a preserved external non-null PPtr')
        ext = next((x for x in group['externals'] if x['fileId'] == fid), None)
        if ext is None:
            raise ValueError('Missing external file identity')
        cab = ext['path'].split('/')[-1]
        if cab not in assets:
            raise ValueError('Unresolved dependency CAB: ' + cab)
        asset, file = assets[cab]
        obj = asset.objects.get(int(oid))
        if obj is None or obj.type.name != expected:
            raise ValueError('Dependency PPtr type mismatch')
        path = paths.get((cab, oid))
        if path is None:
            raise ValueError('Dependency is not bound to an asset path')
        ref = {**source_ref(file, path, obj), 'serializedFile': cab, 'sha256': selected[file]['sha256']}
        return obj, ref
    out.mkdir(parents=True, exist_ok=True)
    (out / 'textures').mkdir(exist_ok=True); (out / 'shaders').mkdir(exist_ok=True)
    textures = {}; shaders = {}; materials = {}
    for group_name, group in media['groups'].items():
        objects = {x['source']['objectId']: x for x in group['objects']}
        renderers = [objects[i] for i in group['hierarchyIds'] if objects[i]['type'] == 'ParticleSystemRenderer']
        if len(renderers) != 1 or len(renderers[0]['data']['m_Materials']) != 1:
            raise ValueError('Unimplemented material cardinality')
        material_ref = renderers[0]['data']['m_Materials'][0]
        material_group = group
        if material_ref['m_FileID'] != 0:
            ext = next((x for x in group['externals'] if x['fileId'] == material_ref['m_FileID']), None)
            if ext is None:
                raise ValueError('Missing external material file identity')
            cab = ext['path'].split('/')[-1]
            matches = [g for g in media['groups'].values() if g['source']['serializedFile'] == cab]
            if len(matches) != 1:
                raise ValueError('External particle material is not uniquely exported')
            material_group = matches[0]
            objects = {x['source']['objectId']: x for x in material_group['objects']}
        material = objects[material_ref['m_PathID']]
        if material['type'] != 'Material':
            raise ValueError('Particle material type mismatch')
        data = material['data']; shader, ref = resolve(material_group, data['m_Shader'], 'Shader')
        keyword_set = set(data['m_ShaderKeywords'].split())
        shader_data = shader.read(); tree = shader.read_typetree()
        if shader_data.platforms != [4] or len(tree['m_ParsedForm']['m_SubShaders']) != 1:
            raise ValueError('Unimplemented shader platform/subshader selection')
        passes = tree['m_ParsedForm']['m_SubShaders'][0]['m_Passes']
        if len(passes) != 1:
            raise ValueError('Unimplemented shader pass selection')
        pas = passes[0]; names = {v: k for k, v in pas['m_NameIndices']}
        start = shader_data.offsets[0][0]; end = start + shader_data.compressedLengths[0][0]
        blob = CompressionHelper.decompress_lz4(bytes(shader_data.compressedBlob)[start:end], shader_data.decompressedLengths[0][0])
        programs = ShaderProgram(EndianBinaryReader(blob, endian='<'), shader.version)
        selected_programs = {}
        for stage in ['progVertex', 'progFragment']:
            candidates = [s for s in pas[stage]['m_SubPrograms']
                if {names[k] for k in s['m_GlobalKeywordIndices'] + s['m_LocalKeywordIndices']} == keyword_set]
            if len(candidates) != 1:
                raise ValueError('Missing/ambiguous shader keyword variant')
            sub = candidates[0]; index = sub['m_BlobIndex']; p = programs.m_SubPrograms[index]
            code = bytes(p.m_ProgramCode); code = code[code.index(b'DXBC'):]
            sha = hashlib.sha256(code).hexdigest(); target = 'shaders/' + sha + '.dxbc'
            (out / target).write_bytes(code)
            selected_programs[stage] = {'index': index, 'sha256': sha, 'file': target,
                'keywords': sorted(keyword_set), 'parameters': preserve_ids(sub)}
        shader_key = ref['serializedFile'] + ':' + ref['objectId'] + ':' + ' '.join(sorted(keyword_set))
        shaders[shader_key] = {'source': ref, 'name': tree['m_ParsedForm']['m_Name'],
            'programs': selected_programs, 'state': preserve_ids(pas['m_State']), 'names': pas['m_NameIndices']}
        texture_bindings = {}
        for name, binding in data['m_SavedProperties']['m_TexEnvs']:
            if binding['m_Texture']['m_PathID'] == '0':
                continue
            texture, texture_ref = resolve(material_group, binding['m_Texture'], 'Texture2D')
            key = texture_ref['serializedFile'] + ':' + texture_ref['objectId']
            tex = texture.read()
            # Exact mip zero in top-to-bottom RGBA rows, no PNG color conversion.
            picture = get_image_from_texture2d(tex, flip=True).convert('RGBA')
            raw = picture.tobytes(); sha = hashlib.sha256(raw).hexdigest(); target = 'textures/' + sha + '.rgba'
            (out / target).write_bytes(raw)
            png = io.BytesIO(); picture.save(png, format='PNG'); png_name = 'textures/' + sha + '.png'; (out / png_name).write_bytes(png.getvalue())
            settings = tex.m_TextureSettings
            textures[key] = {'source': texture_ref, 'width': tex.m_Width, 'height': tex.m_Height,
                'file': target, 'sha256': sha, 'png': png_name, 'rowOrder': 'top-to-bottom', 'mipLevel': 0,
                'filterMode': settings.m_FilterMode, 'wrap': [settings.m_WrapU, settings.m_WrapV],
                'colorSpace': tex.m_ColorSpace, 'mipCount': tex.m_MipCount}
            texture_bindings[name] = {'key': key, 'scale': binding['m_Scale'], 'offset': binding['m_Offset']}
        materials[group_name] = {'source': material['source'], 'shader': shader_key,
            'properties': data['m_SavedProperties'], 'keywords': sorted(keyword_set), 'textures': texture_bindings}
    sources = sorted(selected.values(), key=lambda x: x['file'])
    for item in sources:
        if digest(source / item['file']) != item['sha256']:
            raise ValueError('Particle dependency source changed during export')
    settings_file = 'FINAL FANTASY VI_Data/globalgamemanagers'
    settings_sha = digest(source / settings_file)
    settings_env = UnityPy.load(str(source / settings_file))
    players = [o for o in settings_env.objects if o.type.name == 'PlayerSettings']
    if len(players) != 1:
        raise ValueError('Missing/ambiguous source color-space settings')
    player = players[0]
    # PlayerSettings is a built-in serialized object, not an addressable
    # Assets/ path. Keep its real file/object identity instead of inventing one.
    settings = {'source': {'file': settings_file, 'objectId': str(player.path_id),
        'serializedFile': player.assets_file.name, 'sha256': settings_sha}, 'type': 'PlayerSettings',
        'activeColorSpace': player.read_typetree()['m_ActiveColorSpace']}
    if digest(source / settings_file) != settings_sha:
        raise ValueError('Source color-space settings changed during export')
    result = {'formatVersion': 1, 'adapterVersion': 'field-particle-dependencies-0.1.0',
        'parentSourceSetHash': manifest['sourceSetHash'], 'effectMediaSha256': hashlib.sha256(media_bytes).hexdigest(),
        'sources': sources, 'sourceSetHash': hashlib.sha256(canonical(sources).encode()).hexdigest(),
        'unityVersion': '2019.4.20f1', 'materials': materials, 'shaders': shaders, 'textures': textures, 'settings': settings,
        'limitations': ['Mip-zero export does not establish raster derivative or mip-selection equivalence.',
                        'Dependency resolution does not grant Noise, RNG or prewarm execution.']}
    write_json(out / 'dependencies.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(out).as_posix(), 'sha256': digest(p)} for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'snapshot.json']})
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--media', type=Path, required=True)
    parser.add_argument('--bundles', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = export_dependencies(args.source.resolve(), args.media.resolve(), args.bundles.split(','), args.output.resolve())
    print(canonical({'materials': len(result['materials']), 'shaders': len(result['shaders']),
        'textures': len(result['textures']), 'sourceSetHash': result['sourceSetHash']}))
