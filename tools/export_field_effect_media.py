"""Export exact field EffectPrefab object graphs; this does not simulate particles.

Every PPtr path ID is a decimal string. Source bundles must belong to the locked
corpus. External material/texture/shader links remain explicit dependencies.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import struct
from pathlib import Path, PurePosixPath
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'source_adapter'))
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, source_ref, write_json


NONFINITE_TAG = '$unityDecodedFloat64'


def preserve_ids(value):
    if isinstance(value, float) and not math.isfinite(value):
        return {NONFINITE_TAG: {'kind': 'nan' if math.isnan(value) else 'positive-infinity' if value > 0 else 'negative-infinity',
            'encoding': 'ieee754-binary64-little-endian', 'bits': struct.pack('<d', value).hex()}}
    if isinstance(value, dict):
        if NONFINITE_TAG in value or '$unityBytes' in value:
            raise ValueError('Source collides with typed scalar tag')
        return {key: str(item) if key == 'm_PathID' else preserve_ids(item)
                for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [preserve_ids(item) for item in value]
    if isinstance(value, bytes):
        # Object raw bytes remain the source authority; this explicit payload
        # is lossless as well, unlike a digest-only replacement.
        return {'$unityBytes': {'encoding': 'hex', 'bytes': value.hex()}}
    return value


def export_field_effect_media(source: Path, groups: list[str], out: Path):
    import UnityPy
    locked = checked_snapshot(REPO / 'build/corpus')
    manifest = json.loads(locked['corpus.json'])
    if hashlib.sha256(canonical(manifest['sources']).encode()).hexdigest() != manifest['sourceSetHash']:
        raise ValueError('Corpus source manifest changed')
    sources = {item['file']: item for item in manifest['sources']}
    if not groups or len(set(groups)) != len(groups):
        raise ValueError('Expected explicit unique effect asset groups')
    out.mkdir(parents=True, exist_ok=True)
    raw_out = out / 'raw'; raw_out.mkdir(exist_ok=True)
    selected = []
    result = {}
    for group in sorted(groups):
        if not group or group != group.lower() or '/' in group or '\\' in group:
            raise ValueError('Invalid effect asset group')
        matching = [name for name in sources if PurePosixPath(name).name.startswith(group + '_assets_all_')]
        if len(matching) != 1:
            raise ValueError('Missing/ambiguous effect bundle: ' + group)
        file = matching[0]
        if digest(source / file) != sources[file]['sha256']:
            raise ValueError('Effect source changed: ' + file)
        selected.append(sources[file])
        env = UnityPy.load(str(source / file))
        prefabs = [(path, obj.deref()) for path, obj in env.container.items()
                   if path.endswith('/Prefabs/EffectPrefab.prefab')]
        if len(prefabs) != 1:
            raise ValueError('Missing/ambiguous EffectPrefab: ' + group)
        path, prefab = prefabs[0]
        asset = prefab.assets_file
        def ref(obj):
            return {**source_ref(file, path, obj), 'serializedFile': asset.name,
                    'sha256': sources[file]['sha256']}
        def local(pointer, expected=None):
            if pointer['m_FileID'] != 0 or pointer['m_PathID'] == 0:
                raise ValueError('Effect hierarchy requires a local non-null pointer')
            obj = asset.objects[pointer['m_PathID']]
            if expected and obj.type.name != expected:
                raise ValueError('Effect hierarchy type mismatch')
            return obj
        # Follow only the selected prefab. The bundle also contains the original
        # effect prefab; counting every ParticleSystem would double its emitters.
        visited, active, graph = set(), set(), []
        def visit(go):
            if go.path_id in active or go.path_id in visited:
                raise ValueError('Cyclic/aliased effect prefab hierarchy')
            active.add(go.path_id); visited.add(go.path_id)
            data = go.read_typetree()
            components = [local(item['component']) for item in data['m_Component']]
            transforms = [obj for obj in components if obj.type.name == 'Transform']
            if len(transforms) != 1:
                raise ValueError('Missing/ambiguous effect transform')
            graph.extend([str(go.path_id), *[str(obj.path_id) for obj in components]])
            transform = transforms[0]
            for child in transform.read_typetree()['m_Children']:
                child_transform = local(child, 'Transform')
                child_data = child_transform.read_typetree()
                if child_data['m_Father'] != {'m_FileID': 0, 'm_PathID': transform.path_id}:
                    raise ValueError('Effect hierarchy parent mismatch')
                visit(local(child_data['m_GameObject'], 'GameObject'))
            active.remove(go.path_id)
        visit(prefab)
        objects = []
        for obj in sorted(asset.objects.values(), key=lambda obj: obj.path_id):
            if obj.type.name == 'AssetBundle':
                continue
            raw = obj.get_raw_data(); raw_sha = hashlib.sha256(raw).hexdigest()
            raw_path = 'raw/' + raw_sha + '.bin'
            (out / raw_path).write_bytes(raw)
            objects.append({'source': ref(obj), 'type': obj.type.name,
                            'rawObject': {'file': raw_path, 'sha256': raw_sha, 'bytes': len(raw)},
                            'data': preserve_ids(obj.read_typetree())})
        result[group] = {'source': ref(prefab), 'rootId': str(prefab.path_id),
            'hierarchyIds': graph, 'objects': objects,
            'externals': [{'fileId': index + 1, 'path': item.path,
                           'guid': bytes(item.guid).hex(), 'type': item.type}
                          for index, item in enumerate(asset.externals)]}
        if digest(source / file) != sources[file]['sha256']:
            raise ValueError('Effect source changed during export')
    selected.sort(key=lambda item: item['file'])
    output = {'formatVersion': 1, 'adapterVersion': 'field-effect-media-lossless-wip-0.2.0',
        'parentSourceSetHash': manifest['sourceSetHash'], 'sources': selected,
        'sourceSetHash': hashlib.sha256(canonical(selected).encode()).hexdigest(),
        'groups': result,
        'scalarCodec': {'tag': NONFINITE_TAG, 'version': 1, 'encoding': 'decoded Python binary64 bit pattern; original serialized object bytes authoritative', 'nonFiniteValuesAreNotRuntimeNumbers': True},
        'limitations': ['Serialized object graphs are not a particle simulator or a renderer admission.',
                        'External shaders, textures and materials retain unresolved exact PPtrs.']}
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / 'media.json', output)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': path.relative_to(out).as_posix(), 'sha256': digest(path)} for path in sorted(out.rglob('*')) if path.is_file() and path.name != 'snapshot.json']})
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--groups', required=True, help='Explicit comma-separated asset group names')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = export_field_effect_media(args.source.resolve(), args.groups.split(','), args.output.resolve())
    print(canonical({'groups': len(result['groups']), 'sourceSetHash': result['sourceSetHash'],
                     'output': str(args.output.resolve())}))
