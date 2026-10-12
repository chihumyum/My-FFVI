"""Export the source field effect parent and particle camera platform inputs.

Object identity and active state are retained. This does not instantiate a
Unity scene or manufacture the live manager's allocated positionY.
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


def export_view(source: Path, output: Path):
    import UnityPy
    corpus = json.loads(checked_snapshot(REPO / 'build/corpus')['corpus.json'])
    if hashlib.sha256(canonical(corpus['sources']).encode()).hexdigest() != corpus['sourceSetHash']:
        raise ValueError('Changed corpus source manifest')
    selected = {}

    def load(group, suffix='_assets_all_'):
        found = [s for s in corpus['sources'] if Path(s['file']).name.startswith(group + suffix)]
        if len(found) != 1 or digest(source / found[0]['file']) != found[0]['sha256']:
            raise ValueError('Missing or changed particle view source: ' + group)
        item = found[0]; selected[item['file']] = item
        env = UnityPy.load(str(source / item['file']))
        return env, item

    def object_data(obj, item, path):
        ref = ({'file': item['file'], 'assetPath': path, 'objectId': str(obj.path_id)}
               if path == 'globalgamemanagers' else source_ref(item['file'], path, obj))
        return {'source': {**ref, 'serializedFile': obj.assets_file.name,
                           'sha256': item['sha256']}, 'type': obj.type.name,
                'data': preserve_ids(obj.read_typetree())}

    def local(owner, pointer, expected):
        if pointer['m_FileID'] != 0 or pointer['m_PathID'] == 0:
            raise ValueError('Unbound particle view local pointer')
        obj = owner.assets_file.objects[pointer['m_PathID']]
        if obj.type.name != expected: raise ValueError('Particle view pointer type mismatch')
        return obj

    def transforms(obj, item, path):
        result, seen = [], set()
        while True:
            if obj.path_id in seen: raise ValueError('Cyclic particle view transform')
            seen.add(obj.path_id); data = obj.read_typetree()
            game_object = local(obj, data['m_GameObject'], 'GameObject')
            result.append({'transform': object_data(obj, item, path),
                           'gameObject': object_data(game_object, item, path)})
            if data['m_Father'] == {'m_FileID': 0, 'm_PathID': 0}: return result
            obj = local(obj, data['m_Father'], 'Transform')

    scene, scene_source = load('scene_maingame', '_scenes_all_')
    fields = []
    for obj in scene.objects:
        if obj.type.name != 'MonoBehaviour': continue
        try: data = obj.read_typetree()
        except ValueError: continue
        if 'mapRendererParent' in data and 'effectParent' in data: fields.append((obj, data))
    if len(fields) != 1: raise ValueError('Ambiguous FieldMap effect parent')
    field, data = fields[0]
    scene_paths = [path for obj in scene.objects if obj.type.name == 'AssetBundle'
                   for path, cab in obj.read_typetree()['m_SceneHashes'] if cab == field.assets_file.name]
    if len(scene_paths) != 1: raise ValueError('Unbound FieldMap scene path')
    parent = local(field, data['effectParent'], 'Transform')
    root = {'fieldMap': object_data(field, scene_source, scene_paths[0]),
            'ancestors': transforms(parent, scene_source, scene_paths[0])}

    chara, chara_source = load('chara_field')
    matches = [(path, p.deref()) for path, p in chara.container.items()
               if path.endswith('/FieldEffectParticleEntity.prefab')]
    if len(matches) != 1: raise ValueError('Unbound field particle entity prefab')
    path, go = matches[0]; data = go.read_typetree()
    components = [go.assets_file.objects[x['component']['m_PathID']] for x in data['m_Component']
                  if x['component']['m_FileID'] == 0]
    ts = [o for o in components if o.type.name == 'Transform']
    if len(ts) != 1 or len(components) != len(data['m_Component']):
        raise ValueError('Unbound field particle entity components')
    entity = {'gameObject': object_data(go, chara_source, path),
              'ancestors': transforms(ts[0], chara_source, path)}

    prefabs = {}
    for group in ['ef_ff6_m_001', 'ef_ff6_m_002', 'ef_ff6_m_003', 'ef_ff6_m_004', 'ef_ff6_m_016']:
        env, item = load(group)
        roots = [(p, o.deref()) for p, o in env.container.items() if p.endswith('/EffectPrefab.prefab')]
        if len(roots) != 1: raise ValueError('Ambiguous effect prefab: ' + group)
        path, prefab = roots[0]
        particles, seen = [], set()
        def visit(go):
            if go.path_id in seen: raise ValueError('Aliased effect prefab hierarchy')
            seen.add(go.path_id)
            components = []
            for c in go.read_typetree()['m_Component']:
                pointer = c['component']
                if pointer['m_FileID'] != 0: raise ValueError('External prefab component')
                components.append(go.assets_file.objects[pointer['m_PathID']])
            particles.extend(o for o in components if o.type.name == 'ParticleSystem')
            ts = [o for o in components if o.type.name == 'Transform']
            if len(ts) != 1: raise ValueError('Ambiguous prefab transform')
            for child in ts[0].read_typetree()['m_Children']:
                ct = local(ts[0], child, 'Transform')
                if ct.read_typetree()['m_Father'] != {'m_FileID': 0, 'm_PathID': ts[0].path_id}:
                    raise ValueError('Broken prefab parent pointer')
                visit(local(ct, ct.read_typetree()['m_GameObject'], 'GameObject'))
        visit(prefab)
        if len(particles) != 1: raise ValueError('Ambiguous source particle component')
        particle = particles[0]; pd = particle.read_typetree()
        go = local(particle, pd['m_GameObject'], 'GameObject'); gd = go.read_typetree()
        ts = [go.assets_file.objects[c['component']['m_PathID']] for c in gd['m_Component']
              if c['component']['m_FileID'] == 0 and
              go.assets_file.objects[c['component']['m_PathID']].type.name == 'Transform']
        if len(ts) != 1: raise ValueError('Ambiguous source particle transform')
        prefabs[group] = {'source': object_data(prefab, item, path)['source'],
                         'particleSource': object_data(particle, item, path)['source'],
                         'playOnAwake': pd['playOnAwake'],
                         'ancestors': transforms(ts[0], item, path)}

    file = 'FINAL FANTASY VI_Data/globalgamemanagers'
    item = {'file': file, 'sha256': digest(source / file)}
    if item['sha256'] != 'bc33b3eaaab47d14fbbf792f5bcc664c7e2f4787376449306739bce658dc7881':
        raise ValueError('Unrecovered particle view global settings')
    selected[file] = item
    settings = UnityPy.load(str(source / file)); objects = {o.path_id: o for o in settings.objects}
    settings_output = {}
    for key, object_id, expected in [('player', 1, 'PlayerSettings'), ('graphics', 7, 'GraphicsSettings'),
                                     ('build', 11, 'BuildSettings')]:
        obj = objects[object_id]
        if obj.type.name != expected: raise ValueError('Wrong particle view settings object')
        settings_output[key] = object_data(obj, item, 'globalgamemanagers')
    sources = sorted(selected.values(), key=lambda s: s['file'])
    for item in sources:
        if digest(source / item['file']) != item['sha256']: raise ValueError('Particle view source changed during export')
    result = {'formatVersion': 1, 'adapterVersion': 'field-particle-view-0.1.0',
              'parentSourceSetHash': corpus['sourceSetHash'], 'sources': sources,
              'sourceSetHash': hashlib.sha256(canonical(sources).encode()).hexdigest(),
              'effectRoot': root, 'entity': entity, 'prefabs': prefabs, 'settings': settings_output}
    output.mkdir(parents=True, exist_ok=True); write_json(output / 'view.json', result)
    write_json(output / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': 'view.json', 'sha256': digest(output / 'view.json')}]})
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', required=True, type=Path); p.add_argument('--output', required=True, type=Path)
    args = p.parse_args(); result = export_view(args.source.resolve(), args.output.resolve())
    print(canonical({'sourceSetHash': result['sourceSetHash'], 'prefabs': len(result['prefabs'])}))
