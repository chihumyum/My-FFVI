"""Export package-scoped map atlases and all field character sprites from the locked corpus."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile
from sprite_logical_canvas import logical_canvas, sprite_canvas_metadata, SPRITE_LOGICAL_CANVAS
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, source_ref, write_json


def package_path(package_path, relative, extension):
    path = PurePosixPath(relative)
    if not relative or path.is_absolute() or '..' in path.parts or '\\' in relative:
        raise ValueError('Unsafe package media reference')
    return str(PurePosixPath(package_path).parent / (relative + extension))


def export_world_media(source, out, reuse_media=None):
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
    packages = {}; characters = {}; projections = []; projection_issues = []
    seed = seed_files = None
    if reuse_media is not None:
        seed_files = checked_snapshot(reuse_media)
        seed = json.loads(seed_files['media.json'])
        if (seed['formatVersion'] != 1 or seed['adapterVersion'] != 'world-media-0.1.0' or
                seed['parentSourceSetHash'] != manifest['sourceSetHash'] or seed['sources'] != selected_sources or
                hashlib.sha256(canonical(seed['sources']).encode()).hexdigest() != seed['sourceSetHash']):
            raise ValueError('Previous source media seed identity mismatch')

    def ref(file, path, obj):
        return {**source_ref(file, path, obj), 'serializedFile': obj.assetsfile.name,
                'sha256': sources[file]['sha256']}

    def picture(image, kind, provenance, **extra):
        buf = io.BytesIO(); image.save(buf, format='PNG'); raw = buf.getvalue()
        sha = hashlib.sha256(raw).hexdigest(); path = kind + '/' + sha + '.png'
        (out / kind).mkdir(exist_ok=True); (out / path).write_bytes(raw)
        return {'source': provenance, 'file': path, 'sha256': sha, 'width': image.width,
                'height': image.height, **extra}

    def preserve_picture(image, previous):
        raw = seed_files[previous['file']]
        if hashlib.sha256(raw).hexdigest() != previous['sha256']:
            raise ValueError('Previous source media bitmap changed')
        from PIL import Image
        old_image = Image.open(io.BytesIO(raw)).convert('RGBA')
        if old_image.size != image.size or old_image.tobytes() != image.convert('RGBA').tobytes():
            raise ValueError('Previous full-rect Sprite pixels differ from current source parser')
        target = out / previous['file']; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(raw)
        return dict(previous)

    for n, (file, assets) in enumerate(sorted(work.items())):
        env = UnityPy.load(str(source / file))
        container = dict(env.container)
        for a in assets:
            path = a['source']['assetPath']
            if a['kind'] == 'map-package':
                if seed is not None:
                    previous = seed['packages'].get(a['id'])
                    if previous is None or previous['source'] != a['source']:
                        raise ValueError('Previous package source identity changed')
                    for texture in previous['textures'].values():
                        raw = seed_files[texture['file']]
                        if hashlib.sha256(raw).hexdigest() != texture['sha256']:
                            raise ValueError('Previous package atlas bytes changed')
                        target = out / texture['file']; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(raw)
                    packages[a['id']] = previous
                    continue
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
                    sprite_source = ref(file, target, obj)
                    if image.size != (int(sprite.m_Rect.width), int(sprite.m_Rect.height)):
                        try:
                            metadata = sprite_canvas_metadata(sprite)
                            canvas, padding = logical_canvas(image, metadata)
                            proof = {'kind': SPRITE_LOGICAL_CANVAS, 'metadata': metadata,
                                     'decodedSize': list(image.size), 'decodedRgbaSha256': hashlib.sha256(image.convert('RGBA').tobytes()).hexdigest(),
                                     'padding': padding}
                            sprites[sprite.m_Name] = picture(canvas, 'sprites', sprite_source,
                                pivot=[sprite.m_Pivot.x, sprite.m_Pivot.y], representation=SPRITE_LOGICAL_CANVAS,
                                logicalCanvas=proof)
                            projections.append({'asset': key, 'sprite': sprite.m_Name, 'source': sprite_source,
                                                'imageSha256': sprites[sprite.m_Name]['sha256'], 'padding': padding})
                        except (ValueError, AssertionError) as error:
                            issues.append({'sprite': sprite.m_Name, 'source': sprite_source, 'reason': 'Trimmed sprite requires geometry'})
                            projection_issues.append({'asset': key, 'sprite': sprite.m_Name, 'source': sprite_source, 'reason': str(error)})
                        continue
                    previous = seed and seed['characters'].get(key, {}).get('sprites', {}).get(sprite.m_Name)
                    if previous is not None:
                        if (previous['source'] != sprite_source or previous['width'] != image.width or previous['height'] != image.height or
                                previous['pivot'] != [sprite.m_Pivot.x, sprite.m_Pivot.y] or previous['representation'] != 'source-texture-full-rect'):
                            raise ValueError('Previous full-rect Sprite metadata differs from source')
                        sprites[sprite.m_Name] = preserve_picture(image, previous)
                    else:
                        sprites[sprite.m_Name] = picture(image, 'sprites', sprite_source,
                            pivot=[sprite.m_Pivot.x,sprite.m_Pivot.y], representation='source-texture-full-rect')
                for name in sorted(wanted - sprites.keys()):
                    if not any(i.get('sprite') == name for i in issues):
                        issues.append({'sprite': name, 'reason': 'Missing named Sprite'})
                characters[key] = {'animation': {'source': a['source'], 'data': a['data']},
                                   'sprites': sprites, 'issues': issues}
        if (n + 1) % 50 == 0: print(f'Exported media {n + 1}/{len(work)} bundles', flush=True)
    for s in selected_sources:
        if digest(source / s['file']) != s['sha256']: raise ValueError('Source changed during media export')
    result = {'formatVersion': 1, 'adapterVersion': 'world-media-0.2.0',
              'parentSourceSetHash': manifest['sourceSetHash'],
              'sourceSetHash': hashlib.sha256(canonical(selected_sources).encode()).hexdigest(),
              'sources': selected_sources, 'packages': packages, 'characters': characters,
              'spriteLogicalCanvas': {'kind': SPRITE_LOGICAL_CANVAS, 'projections': projections, 'unresolved': projection_issues},
              'limitations': ['Map atlas storage row order is retained; visual parity across all maps is unverified.',
                              'Sprite export is not animation, shader, shadow or character behavior acceptance.']}
    write_json(out / 'media.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(out).as_posix(), 'sha256': digest(p)} for p in sorted(out.rglob('*')) if p.is_file()]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', type=Path, help='Independent output directory; omitting retains the normal world-media publication target')
    parser.add_argument('--reuse-locked-packages', type=Path, help='Verified previous 0.1 media snapshot; retain unchanged atlas/full Sprite bytes')
    args = parser.parse_args()
    staged = Path(tempfile.mkdtemp(prefix='.world-media-', dir=REPO / 'build'))
    target = args.output.resolve() if args.output else REPO / 'build/world-media'; backup = target.with_name('.previous-' + target.name)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        result = export_world_media(args.source.resolve(), staged, args.reuse_locked_packages.resolve() if args.reuse_locked_packages else None)
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
