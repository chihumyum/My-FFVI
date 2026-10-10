"""Extend the locked import with source sprites/messages for the field runtime."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import tempfile
from import_source import REPO, canonical, digest, source_ref, write_json

CHARACTERS = ['mo_ff6_p001', 'mo_ff6_p021', 'mo_ff6_v006_c00', 'mo_ff6_n043_c00', 'mo_ff6_n049_c00']


def checked_snapshot(root):
    result = {}
    for item in json.loads((root / 'snapshot.json').read_text())['files']:
        relative = Path(item['file'])
        if '\\' in item['file'] or relative.is_absolute() or '..' in relative.parts or item['file'] in result:
            raise ValueError('Unsafe or duplicate snapshot entry')
        data = (root / relative).read_bytes()
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError(f"Snapshot changed: {relative}")
        result[item['file']] = data
    return result


def export_field(source, out):
    import UnityPy
    locked = checked_snapshot(REPO / 'build/import')
    project = json.loads(locked['project.json'])
    if hashlib.sha256(canonical(project['sources']).encode()).hexdigest() != project['sourceSetHash']:
        raise ValueError('Source manifest mismatch')
    bundles = source / 'FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64'
    def one(pattern):
        found = sorted(bundles.glob(pattern))
        if len(found) != 1: raise ValueError(f'Ambiguous asset: {pattern}')
        return found[0]
    character_files = {name: one(name + '_assets_all_*.bundle') for name in CHARACTERS}
    files = sorted(character_files.values())
    sources = {s['file']: s for s in project['sources']}
    for f in files:
        rel = f.relative_to(source).as_posix()
        sources[rel] = {'file': rel, 'sha256': digest(f), 'bytes': f.stat().st_size}
    # Read the exact installation matched by the previous import, never another copy.
    for item in sources.values():
        if digest(source / item['file']) != item['sha256']:
            raise ValueError('Source changed: ' + item['file'])
    sources = sorted(sources.values(), key=lambda s: s['file'])
    chars = {}
    for name, file in character_files.items():
        env = UnityPy.load(str(file)); sprites = {}; animation = None
        anim_obj = next(o for p, o in env.container.items() if p.endswith('/anim_info.json'))
        anim_data = json.loads(anim_obj.read().m_Script)
        names = {'Default', 'Default-S', 'WalkB', 'WalkB-S', 'WalkL', 'WalkL-S', 'WalkR', 'WalkR-S', 'RideL', 'RideR'}
        anim_data['animation'] = [a for a in anim_data['animation'] if a['name'] in names]
        sprite_names = {f['sprite_name'] for a in anim_data['animation'] for f in a['frames']}
        for path, obj in sorted(env.container.items()):
            ref = {**source_ref(file.name, path, obj), 'serializedFile': obj.assetsfile.name}
            if obj.type.name == 'TextAsset' and path.endswith('/anim_info.json'):
                animation = {'source': ref, 'data': anim_data}
            if obj.type.name != 'Sprite': continue
            sprite = obj.read()
            if sprite.m_Name not in sprite_names: continue
            picture = sprite.image
            # The runtime currently supports full rectangular sprites, not trimmed meshes.
            if picture.size != (int(sprite.m_Rect.width), int(sprite.m_Rect.height)):
                raise ValueError(f'Trimmed sprite needs explicit geometry: {path}')
            buf = io.BytesIO(); picture.save(buf, format='PNG'); raw = buf.getvalue()
            sha = hashlib.sha256(raw).hexdigest(); target = 'sprites/' + sha + '.png'
            (out / 'sprites').mkdir(exist_ok=True); (out / target).write_bytes(raw)
            if sprite.m_Name in sprites: raise ValueError('Duplicate sprite name')
            sprites[sprite.m_Name] = {'source': ref, 'file': target, 'sha256': sha,
                'width': picture.width, 'height': picture.height,
                'pivot': [sprite.m_Pivot.x, sprite.m_Pivot.y]}
        if animation is None: raise ValueError('Missing animation table: ' + name)
        chars[name] = {'animation': animation, 'sprites': sprites}
    messages = {}; message_sources = []
    file = one('message_assets_all_*.bundle')
    for path, obj in sorted(UnityPy.load(str(file)).container.items()):
        if obj.type.name != 'TextAsset' or not path.endswith('_zhc.txt'): continue
        message_sources.append(source_ref(file.name, path, obj))
        values = {}; messages[Path(path).stem] = values
        for line in obj.read().m_Script.splitlines():
            if '\t' not in line: continue
            key, value = line.split('\t', 1)
            if key in values and values[key] != value: raise ValueError('Conflicting message: '+key)
            values[key] = value
    for item in sources:
        if digest(source / item['file']) != item['sha256']: raise ValueError('Source changed during export')
    result = {'formatVersion': 1, 'adapterVersion': 'field-0.1.0',
        'parentSourceSetHash': project['sourceSetHash'],
        'sourceSetHash': hashlib.sha256(canonical(sources).encode()).hexdigest(), 'sources': sources,
        'characters': chars, 'messages': messages, 'messageSources': message_sources}
    write_json(out / 'field.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(out).as_posix(), 'sha256': digest(p)} for p in sorted(out.rglob('*')) if p.is_file()]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args(); staged = Path(tempfile.mkdtemp(prefix='.field-', dir=REPO / 'build'))
    target = REPO / 'build/field'; backup = REPO / 'build/.previous-field'
    try:
        result = export_field(args.source.resolve(), staged)
        if backup.exists(): raise RuntimeError('Inspect interrupted build/.previous-field first')
        if target.exists(): target.rename(backup)
        try: staged.rename(target)
        except BaseException:
            if backup.exists(): backup.rename(target)
            raise
        if backup.exists(): shutil.rmtree(backup)
        print(canonical({'sourceSetHash': result['sourceSetHash'], 'characters': len(result['characters']),
            'sprites': sum(len(c['sprites']) for c in result['characters'].values()), 'output': str(target)}))
    finally:
        if staged.exists(): shutil.rmtree(staged)

if __name__ == '__main__': main()
