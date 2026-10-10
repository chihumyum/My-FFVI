"""Export package-scoped map atlases and all field character sprites from the locked corpus."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, source_ref, write_json


def package_path(package_path, relative, extension):
    path = PurePosixPath(relative)
    if not relative or path.is_absolute() or '..' in path.parts or '\\' in relative:
        raise ValueError('Unsafe package media reference')
    return str(PurePosixPath(package_path).parent / (relative + extension))


def export_world_media(source, out):
    import UnityPy
    from UnityPy.export.Texture2DConverter import get_image_from_texture2d
    locked = checked_snapshot(REPO / 'build/corpus')
    manifest = json.loads(locked['corpus.json'])
    if hashlib.sha256(canonical(manifest['sources']).encode()).hexdigest() != manifest['sourceSetHash']:
        raise ValueError('Corpus source manifest changed')
    sources = {s['file']: s for s in manifest['sources']}
    work = {}
    for bundle in manifest['bundles']:
        if not bundle['output']: continue
        assets = json.loads(locked[bundle['output']])
        selected = [a for a in assets if a['kind'] == 'map-package' or
                    (a['source']['assetPath'].endswith('/anim_info.json') and isinstance(a['data'].get('animation'), list))]
        if selected: work[bundle['file']] = selected
    selected_sources = [sources[f] for f in sorted(work)]
    for s in selected_sources:
        if digest(source / s['file']) != s['sha256']: raise ValueError('Source changed: ' + s['file'])
    packages = {}; characters = {}

    def ref(file, path, obj):
        return {**source_ref(file, path, obj), 'serializedFile': obj.assetsfile.name,
                'sha256': sources[file]['sha256']}

    def picture(image, kind, provenance, **extra):
        buf = io.BytesIO(); image.save(buf, format='PNG'); raw = buf.getvalue()
        sha = hashlib.sha256(raw).hexdigest(); path = kind + '/' + sha + '.png'
        (out / kind).mkdir(exist_ok=True); (out / path).write_bytes(raw)
        return {'source': provenance, 'file': path, 'sha256': sha, 'width': image.width,
                'height': image.height, **extra}

    for n, (file, assets) in enumerate(sorted(work.items())):
        env = UnityPy.load(str(source / file))
        container = dict(env.container)
        for a in assets:
            path = a['source']['assetPath']
            if a['kind'] == 'map-package':
                textures = {}; issues = []; seen = set()
                for item in a['data'].get('texture', []):
                    name = item['name']
                    if name in seen: raise ValueError('Duplicate package texture alias: ' + name)
                    seen.add(name)
                    target = package_path(path, item['asset'], '.png'); obj = container.get(target)
                    if obj is None or obj.type.name != 'Texture2D':
                        issues.append({'alias': name, 'assetPath': target, 'reason': 'Missing package Texture2D'})
                        continue
                    d = obj.read()
                    textures[name + '.png'] = picture(get_image_from_texture2d(d, flip=False), 'textures',
                        ref(file, target, obj), rowOrder='unity-storage')
                packages[a['id']] = {'source': a['source'], 'textures': textures, 'issues': issues}
            else:
                key = Path(file).name.split('_assets_all_')[0]
                if key.upper() != PurePosixPath(path).parent.name.upper() or key in characters:
                    raise ValueError('Ambiguous character package identity: ' + path)
                sprites = {}; issues = []; seen_sprites = set()
                wanted = {f['sprite_name'] for anim in a['data']['animation'] for f in anim['frames']}
                for target, obj in sorted(container.items()):
                    if obj.type.name != 'Sprite': continue
                    sprite = obj.read()
                    if sprite.m_Name not in wanted: continue
                    if sprite.m_Name in seen_sprites: raise ValueError('Duplicate character sprite: ' + sprite.m_Name)
                    seen_sprites.add(sprite.m_Name)
                    image = sprite.image
                    if image.size != (int(sprite.m_Rect.width), int(sprite.m_Rect.height)):
                        issues.append({'sprite': sprite.m_Name, 'source': ref(file,target,obj),
                                       'reason': 'Trimmed sprite requires geometry'})
                        continue
                    sprites[sprite.m_Name] = picture(image, 'sprites', ref(file,target,obj),
                        pivot=[sprite.m_Pivot.x,sprite.m_Pivot.y], representation='source-texture-full-rect')
                for name in sorted(wanted - sprites.keys()):
                    if not any(i.get('sprite') == name for i in issues):
                        issues.append({'sprite': name, 'reason': 'Missing named Sprite'})
                characters[key] = {'animation': {'source': a['source'], 'data': a['data']},
                                   'sprites': sprites, 'issues': issues}
        if (n + 1) % 50 == 0: print(f'Exported media {n + 1}/{len(work)} bundles', flush=True)
    for s in selected_sources:
        if digest(source / s['file']) != s['sha256']: raise ValueError('Source changed during media export')
    result = {'formatVersion': 1, 'adapterVersion': 'world-media-0.1.0',
              'parentSourceSetHash': manifest['sourceSetHash'],
              'sourceSetHash': hashlib.sha256(canonical(selected_sources).encode()).hexdigest(),
              'sources': selected_sources, 'packages': packages, 'characters': characters,
              'limitations': ['Map atlas storage row order is retained; visual parity across all maps is unverified.',
                              'Sprite export is not animation, shader, shadow or character behavior acceptance.']}
    write_json(out / 'media.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(out).as_posix(), 'sha256': digest(p)} for p in sorted(out.rglob('*')) if p.is_file()]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    staged = Path(tempfile.mkdtemp(prefix='.world-media-', dir=REPO / 'build'))
    target = REPO / 'build/world-media'; backup = REPO / 'build/.previous-world-media'
    try:
        result = export_world_media(args.source.resolve(), staged)
        if backup.exists(): raise RuntimeError('Inspect interrupted build/.previous-world-media first')
        if target.exists(): target.rename(backup)
        try: staged.rename(target)
        except BaseException:
            if backup.exists(): backup.rename(target)
            raise
        if backup.exists(): shutil.rmtree(backup)
        print(canonical({'packages': len(result['packages']), 'characters': len(result['characters']),
                         'sourceSetHash': result['sourceSetHash'], 'output': str(target)}))
    finally:
        if staged.exists(): shutil.rmtree(staged)


if __name__ == '__main__': main()
