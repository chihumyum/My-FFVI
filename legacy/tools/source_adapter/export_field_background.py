"""Export source-bound FarBG textures and the ordinary scroll shader evidence.

This exports identities, not permission to run every background. The compiler
separately admits its recovered center-repeat branch.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import struct
import tempfile
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, source_ref, write_json


def export_field_background(source: Path, out: Path):
    import UnityPy
    from UnityPy.export.Texture2DConverter import get_image_from_texture2d
    from UnityPy.export.ShaderConverter import ShaderProgram
    from UnityPy.helpers import CompressionHelper
    from UnityPy.streams import EndianBinaryReader
    locked = checked_snapshot(REPO / 'build/corpus')
    manifest = json.loads(locked['corpus.json'])
    if hashlib.sha256(canonical(manifest['sources']).encode()).hexdigest() != manifest['sourceSetHash']:
        raise ValueError('Corpus source manifest changed')
    sources = {s['file']: s for s in manifest['sources']}
    wanted = set()
    for bundle in manifest['bundles']:
        if not bundle['output']: continue
        for asset in json.loads(locked[bundle['output']]):
            if not asset['source']['assetPath'].endswith('/tilemap.json'): continue
            for layer in asset['data'].get('layers', []):
                if layer.get('type') != 'imagelayer': continue
                props = {p['name']: p['value'] for p in layer.get('properties', [])}
                group = props.get('tex_asset_group')
                if isinstance(group, str) and group: wanted.add(group)
    selected = {}
    for group in wanted | {'map_common', 'scene_maingame'}:
        suffix = '_scenes_all_' if group == 'scene_maingame' else '_assets_all_'
        files = [s for s in sources if PurePosixPath(s).name.startswith(group + suffix)]
        if len(files) != 1: raise ValueError('Missing/ambiguous background source group: ' + group)
        selected[group] = files[0]
    for file in selected.values():
        if digest(source / file) != sources[file]['sha256']: raise ValueError('Background source changed: ' + file)

    def ref(file, path, obj):
        if callable(getattr(obj, 'deref', None)): obj = obj.deref()
        return {**source_ref(file, path, obj), 'serializedFile': obj.assets_file.name,
                'sha256': sources[file]['sha256']}

    def transform_chain(obj, make_ref):
        chain = []
        while True:
            data = obj.read_typetree()
            if data['m_Father']['m_FileID'] != 0: raise ValueError('External background parent')
            chain.append({'source': make_ref(obj), 'parentId': str(data['m_Father']['m_PathID']),
                'position': data['m_LocalPosition'], 'rotation': data['m_LocalRotation'], 'scale': data['m_LocalScale']})
            if data['m_Father']['m_PathID'] == 0: return chain
            obj = obj.assets_file.objects[data['m_Father']['m_PathID']]

    scene_file = selected['scene_maingame']
    scene = UnityPy.load(str(source / scene_file)); fields = []
    for obj in scene.objects:
        if obj.type.name != 'MonoBehaviour': continue
        try: data = obj.read_typetree()
        except ValueError: continue
        if 'mapRendererParent' in data: fields.append((obj, data))
    if len(fields) != 1: raise ValueError('Ambiguous FieldMap renderer parent')
    field, data = fields[0]; parent = data['mapRendererParent']
    if parent['m_FileID'] != 0: raise ValueError('External FieldMap renderer parent')
    scene_paths = [path for obj in scene.objects if obj.type.name == 'AssetBundle'
                   for path, cab in obj.read_typetree()['m_SceneHashes'] if cab == field.assets_file.name]
    if len(scene_paths) != 1: raise ValueError('Ambiguous field scene source path')
    scene_ref = lambda obj: ref(scene_file, scene_paths[0], obj)
    renderer_chain = transform_chain(field.assets_file.objects[parent['m_PathID']], scene_ref)

    level_file = 'FINAL FANTASY VI_Data/level0'
    level_sha = digest(source / level_file)
    if level_sha != '986e706d7e762c652ac73cacfbb399b1eb69c37ad57d31a8165df0516e07c170':
        raise ValueError('Unrecovered boot scene camera provider')
    level = UnityPy.load(str(source / level_file)); objects = {o.path_id: o for o in level.objects}
    common = objects[305]; raw = common.get_raw_data()
    # CommonCamera serialized fields follow the built-in MonoBehaviour header
    # and the empty name. CameraType.FieldTileMap is enum value 12.
    count = struct.unpack_from('<i', raw, 32)[0]
    if count != 27: raise ValueError('Unrecovered CommonCamera array')
    camera_refs = [struct.unpack_from('<iq', raw, 36 + index * 12) for index in range(count)]
    file_id, camera_id = camera_refs[12]
    if file_id != 0: raise ValueError('External tile map camera')
    camera_obj = objects[camera_id]; camera = camera_obj.read_typetree()
    camera_go = objects[camera['m_GameObject']['m_PathID']].read()
    camera_transform = next(c.component for c in camera_go.m_Component if c.component.type.name == 'Transform')
    level_ref = lambda obj: {'file': level_file, 'sha256': level_sha, 'assetPath': 'level0',
        'objectId': str(obj.path_id), 'serializedFile': obj.assets_file.name}
    render_host = {'kind': 'source-fresh-normal-background-host-v1',
        'fieldMapSource': scene_ref(field), 'rendererParentId': str(parent['m_PathID']),
        'rendererTransforms': renderer_chain, 'commonCameraSource': level_ref(common),
        'cameraIndex': 12, 'selectedCameraId': str(camera_id), 'cameraSource': level_ref(camera_obj),
        'cameraTransforms': transform_chain(camera_transform.deref(), level_ref),
        'orthographic': camera['orthographic'], 'cullingMask': camera['m_CullingMask']['m_Bits']}
    if digest(source / level_file) != level_sha: raise ValueError('Boot scene changed during export')

    images = {}; shader = None; prefab = None
    for group, file in sorted(selected.items()):
        if group == 'scene_maingame': continue
        env = UnityPy.load(str(source / file))
        images[group] = {}
        for path, obj in env.container.items():
            if group == 'map_common':
                if path.endswith('/BackgroundMultipleScroll.prefab'):
                    data = obj.read(); transform = next(c.component for c in data.m_Component
                        if c.component.type.name == 'Transform')
                    prefab = {'source': ref(file, path, obj), 'transform': transform.read_typetree()}
                    # IDs remain decimal strings, including nested serialized PPtrs.
                    def ids(value):
                        if isinstance(value, dict): return {k: str(v) if k == 'm_PathID' else ids(v) for k,v in value.items()}
                        if isinstance(value, list): return [ids(v) for v in value]
                        return value
                    prefab['transform'] = ids(prefab['transform'])
                if path.endswith('/MultipleScrollShader.shader'):
                    data = obj.read()
                    blob = CompressionHelper.decompress_lz4(bytes(data.compressedBlob), data.decompressedLengths[0][0])
                    program = ShaderProgram(EndianBinaryReader(blob, endian='<'), data.object_reader.version)
                    programs = []
                    for index in (4, 5):
                        code = program.m_SubPrograms[index].m_ProgramCode
                        code = code[code.index(b'DXBC'):]
                        sha = hashlib.sha256(code).hexdigest(); target = f'shaders/{sha}.dxbc'
                        (out / 'shaders').mkdir(exist_ok=True); (out / target).write_bytes(code)
                        programs.append({'index': index, 'file': target, 'sha256': sha})
                    shader = {'source': ref(file, path, obj), 'name': data.m_ParsedForm.m_Name,
                              'programs': programs}
                continue
            if obj.type.name != 'Sprite': continue
            sprite = obj.read(); texture = sprite.m_RD.texture; data = texture.read()
            key = PurePosixPath(path).name
            if key in images[group]: raise ValueError('Ambiguous scenery sprite: ' + path)
            # FactoryMapBackground uses Sprite.texture, not Sprite.image. Keep
            # texture coordinates and export top-to-bottom rows for Canvas.
            picture = get_image_from_texture2d(data, flip=True)
            buf = io.BytesIO(); picture.save(buf, format='PNG'); raw = buf.getvalue()
            sha = hashlib.sha256(raw).hexdigest(); target = 'textures/' + sha + '.png'
            (out / 'textures').mkdir(exist_ok=True); (out / target).write_bytes(raw)
            settings = data.m_TextureSettings
            images[group][key] = {'source': ref(file, path, obj),
                'textureSource': ref(file, path, texture), 'file': target, 'sha256': sha,
                'width': data.m_Width, 'height': data.m_Height, 'rowOrder': 'top-to-bottom',
                'filterMode': settings.m_FilterMode, 'wrap': [settings.m_WrapU, settings.m_WrapV],
                'spriteRect': [sprite.m_Rect.x, sprite.m_Rect.y, sprite.m_Rect.width, sprite.m_Rect.height],
                'pixelsPerUnit': sprite.m_PixelsToUnits}
    images.pop('map_common', None)
    if shader is None or prefab is None: raise ValueError('Missing background shader/prefab source')
    selected_sources = sorted((sources[f] for f in selected.values()), key=lambda s: s['file'])
    for item in selected_sources:
        if digest(source / item['file']) != item['sha256']: raise ValueError('Background source changed during export')
    result = {'formatVersion': 1, 'adapterVersion': 'field-background-0.1.0',
        'parentSourceSetHash': manifest['sourceSetHash'], 'sources': selected_sources,
        'sourceSetHash': hashlib.sha256(canonical(selected_sources).encode()).hexdigest(),
        'shader': shader, 'prefab': prefab, 'images': images, 'renderHost': render_host,
        'limitations': ['Media extraction does not admit nine-patch borders, auto scroll, effects or map loops.']}
    write_json(out / 'media.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(out).as_posix(), 'sha256': digest(p)} for p in sorted(out.rglob('*')) if p.is_file()]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    staged = Path(tempfile.mkdtemp(prefix='.field-background-', dir=REPO / 'build'))
    target = REPO / 'build/field-background-media'; backup = REPO / 'build/.previous-field-background-media'
    try:
        result = export_field_background(args.source.resolve(), staged)
        if backup.exists(): raise RuntimeError('Inspect interrupted background media export first')
        if target.exists(): target.rename(backup)
        try: staged.rename(target)
        except BaseException:
            if backup.exists(): backup.rename(target)
            raise
        if backup.exists(): shutil.rmtree(backup)
        print(canonical({'groups': len(result['images']), 'textures': sum(map(len, result['images'].values())),
                         'sourceSetHash': result['sourceSetHash'], 'output': str(target)}))
    finally:
        if staged.exists(): shutil.rmtree(staged)


if __name__ == '__main__': main()
