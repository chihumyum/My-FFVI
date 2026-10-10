"""Export the source GpsIconList and its exact SpriteAtlas members, without name guessing."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import tempfile
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, source_ref, write_json


def local_reference(owner, pointer, type_name):
    if pointer['m_FileID'] != 0:
        raise ValueError('External map UI reference requires explicit resolution')
    obj = owner.assets_file.objects.get(int(pointer['m_PathID']))
    if obj is None or obj.type.name != type_name:
        raise ValueError('Missing or mistyped map UI reference')
    return obj


def export_map_ui(source, out):
    import UnityPy
    locked = checked_snapshot(REPO / 'build/corpus')
    manifest = json.loads(locked['corpus.json'])
    if hashlib.sha256(canonical(manifest['sources']).encode()).hexdigest() != manifest['sourceSetHash']:
        raise ValueError('Corpus source manifest changed')
    selected = [s for s in manifest['sources'] if s['file'] == 'GameAssembly.dll' or
                s['file'].endswith('/Metadata/global-metadata.dat') or
                Path(s['file']).name.startswith('map_ui_assets_all_')]
    if len(selected) != 3:
        raise ValueError('Ambiguous or missing map UI/native sources')
    selected.sort(key=lambda s: s['file'])
    for s in selected:
        if digest(source / s['file']) != s['sha256']:
            raise ValueError('Source changed: ' + s['file'])
    bundle = next(s for s in selected if Path(s['file']).name.startswith('map_ui_assets_all_'))
    env = UnityPy.load(str(source / bundle['file']))
    paths = {}
    for path, obj in env.container.items():
        paths.setdefault((obj.assetsfile.name, str(obj.path_id)), set()).add(path)

    def ref(obj):
        matches = paths.get((obj.assets_file.name, str(obj.path_id)), set())
        if len(matches) != 1:
            raise ValueError('Missing or ambiguous container path')
        return {**source_ref(bundle['file'], next(iter(matches)), obj),
                'serializedFile': obj.assets_file.name, 'sha256': bundle['sha256']}

    candidates = []
    for obj in env.objects:
        if obj.type.name != 'MonoBehaviour': continue
        data = obj.read_typetree()
        script_ref = data.get('m_Script', {})
        if script_ref.get('m_FileID') != 0: continue
        script = local_reference(obj, script_ref, 'MonoScript').read_typetree()
        if (script['m_AssemblyName'], script['m_Namespace'], script['m_ClassName']) == (
                'Assembly-CSharp.dll', 'Last.UI', 'GpsIconList'):
            candidates.append((obj, data))
    if len(candidates) != 1:
        raise ValueError('Missing or ambiguous GpsIconList')
    owner, config = candidates[0]
    atlas = local_reference(owner, config['iconAtlas'], 'SpriteAtlas')
    # The component lives inside this prefab; retain both its path and component identity.
    prefab = local_reference(owner, config['m_GameObject'], 'GameObject')
    config_source = {**ref(prefab), 'objectId': str(owner.path_id), 'pointer': '/GpsIconList'}
    sprites = {}
    for pointer in atlas.read_typetree()['m_PackedSprites']:
        obj = local_reference(atlas, pointer, 'Sprite')
        sprite = obj.read(); name = sprite.m_Name
        if name in sprites: raise ValueError('Duplicate named atlas sprite: ' + name)
        image = sprite.image
        if image.size != (int(sprite.m_Rect.width), int(sprite.m_Rect.height)):
            raise ValueError('Trimmed UI sprite requires geometry: ' + name)
        buf = io.BytesIO(); image.save(buf, format='PNG'); raw = buf.getvalue()
        sha = hashlib.sha256(raw).hexdigest(); path = 'sprites/' + sha + '.png'
        (out / 'sprites').mkdir(exist_ok=True); (out / path).write_bytes(raw)
        sprites[name] = {'file': path, 'sha256': sha, 'width': image.width, 'height': image.height,
                         'pivot': [sprite.m_Pivot.x, sprite.m_Pivot.y], 'source': ref(obj)}
    for s in selected:
        if digest(source / s['file']) != s['sha256']:
            raise ValueError('Source changed during map UI export')
    result = {'formatVersion': 1, 'adapterVersion': 'map-ui-0.1.0',
              'parentSourceSetHash': manifest['parentSourceSetHash'],
              'corpusSourceSetHash': manifest['sourceSetHash'],
              'sourceSetHash': hashlib.sha256(canonical(selected).encode()).hexdigest(),
              'sources': selected, 'config': {'source': config_source, 'atlas': ref(atlas),
                  'spriteNames': config['spriteNames'], 'shopSignNames': config['shopSignNames']},
              'sprites': sprites}
    write_json(out / 'media.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(out).as_posix(), 'sha256': digest(p)}
        for p in sorted(out.rglob('*')) if p.is_file()]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    staged = Path(tempfile.mkdtemp(prefix='.map-ui-', dir=REPO / 'build'))
    target = REPO / 'build/map-ui'; backup = REPO / 'build/.previous-map-ui'
    try:
        result = export_map_ui(args.source.resolve(), staged)
        if backup.exists(): raise RuntimeError('Inspect interrupted build/.previous-map-ui first')
        if target.exists(): target.rename(backup)
        try: staged.rename(target)
        except BaseException:
            if backup.exists(): backup.rename(target)
            raise
        if backup.exists(): shutil.rmtree(backup)
        print(canonical({'sprites': len(result['sprites']), 'sourceSetHash': result['sourceSetHash'],
                         'output': str(target)}))
    finally:
        if staged.exists(): shutil.rmtree(staged)


if __name__ == '__main__': main()
