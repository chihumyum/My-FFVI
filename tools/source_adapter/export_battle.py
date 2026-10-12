"""Export source encounter selections and character media; source stays read-only."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import tempfile
from import_source import REPO, canonical, digest, source_ref, write_json
from export_field import checked_snapshot


def street_encounters(project):
    """Follow encounter continuations from explicit opening-event roots, not all map eras."""
    scripts = {Path(p).stem: a for p, a in project['narshe']['assets'].items()
               if isinstance(a['data'], dict) and 'Mnemonics' in a['data']}
    pending = ['sc_e_0002', 'sc_e_0004', 'sc_e_0005', 'sc_e_0006']
    visited = set(); found = set()
    while pending:
        name = pending.pop()
        if name in visited: continue
        visited.add(name)
        if name not in scripts: raise ValueError('Missing street script: ' + name)
        for op in scripts[name]['data']['Mnemonics']:
            if op['mnemonic'] != 'Encount': continue
            found.add(op['operands']['iValues'][0])
            pending.append(op['operands']['sValues'][0])
    return sorted(found)


def encounter_rows(project, tables, requested=()):
    """Extend the regression selection without granting story reachability.

    Each requested identity must name one source row. The compiler, not media
    selection, decides which formations and rules the runtime can execute.
    """
    identities = set(street_encounters(project))
    for identity in requested:
        if type(identity) is not int or not 0 < identity <= 0x7fffffff:
            raise ValueError('Invalid requested encounter identity')
        identities.add(identity)
    result = []
    for identity in sorted(identities):
        found = [r for r in tables['monster_party.csv'] if r['id'] == str(identity)]
        if len(found) != 1:
            raise ValueError(f'Unresolved monster_party.csv:{identity}')
        result.append(found[0])
    return result


def full_rect_picture(sprite, path):
    texture = sprite.m_RD.texture.deref_parse_as_object()
    # Sprite.image uses a tight mesh box and can return fractional offsets.
    # This representation keeps the source canvas and its original pivot.
    if (sprite.m_SpriteAtlas or sprite.m_RD.settingsRaw != 64 or
        sprite.m_Rect.x != 0 or sprite.m_Rect.y != 0 or
        (texture.m_Width, texture.m_Height) != (sprite.m_Rect.width, sprite.m_Rect.height)):
        raise ValueError('Sprite needs an atlas/mesh geometry adapter: ' + path)
    picture = texture.image
    if picture.size != (texture.m_Width, texture.m_Height):
        raise ValueError('Decoded texture dimensions changed: ' + path)
    return picture


def sprite_geometry(sprite, path):
    """Keep source sampling/units; consumers decide which geometry they support."""
    texture = sprite.m_RD.texture.deref_parse_as_object()
    settings = texture.m_TextureSettings
    scale = sprite.m_PixelsToUnits
    if not isinstance(scale, (int, float)) or not math.isfinite(scale) or scale <= 0:
        raise ValueError('Invalid source sprite pixels per unit: ' + path)
    wrap = [settings.m_WrapU, settings.m_WrapV]
    filtering = settings.m_FilterMode
    if any(type(value) is not int or value not in range(4) for value in wrap):
        raise ValueError('Unresolved source texture wrapping: ' + path)
    if type(filtering) is not int or filtering not in range(3):
        raise ValueError('Unresolved source texture filtering: ' + path)
    return {'pixelsPerUnit': scale, 'textureWrap': wrap, 'filterMode': filtering}


def character_rows(tables, requested=()):
    """Media selection never changes INIT_PARTY or grants a character to the game."""
    initial = [r for r in tables['initialize_data.csv'] if r['key_name'].startswith('INIT_PARTY_')]
    identities = {int(r['value1']) for r in initial}
    for identity in requested:
        if type(identity) is not int or identity <= 0:
            raise ValueError('Invalid requested character identity')
        identities.add(identity)
    result = []
    for identity in sorted(identities):
        found = [r for r in tables['character_status.csv'] if r['id'] == str(identity)]
        if len(found) != 1:
            raise ValueError(f'Unresolved character_status.csv:{identity}')
        result.append(found[0])
    return result


def export_battle(source: Path, out: Path, character_ids=(), encounter_ids=()):
    import UnityPy
    parent = checked_snapshot(REPO / 'build/import')
    project = json.loads(parent['project.json'])
    tables = json.loads(parent['tables.json'])
    if hashlib.sha256(canonical(project['sources']).encode()).hexdigest() != project['sourceSetHash']:
        raise ValueError('Base source manifest changed')
    def row(table, identity):
        found = [r for r in tables[table] if r['id'] == str(identity)]
        if len(found) != 1: raise ValueError(f'Unresolved {table}:{identity}')
        return found[0]
    bundle_root = source / 'FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64'
    def one(name):
        found = sorted(bundle_root.glob(name + '_assets_all_*.bundle'))
        if len(found) != 1: raise ValueError('Ambiguous bundle: ' + name)
        return found[0]
    parties = encounter_rows(project, tables, encounter_ids)
    party_ids = [int(party['id']) for party in parties]
    monsters = [row('monster.csv', party[f'monster{i}']) for party in parties
                for i in range(1, 10) if int(party[f'monster{i}'])]
    characters = character_rows(tables, character_ids)
    names = {'bc_ff6_p022', 'monster_ai', 'battle_script', 'battleextradata', 'misc'}
    names.update(row('battle_background_asset.csv', p['battle_background_asset_id'])['asset_name'] for p in parties)
    names.update(row('character_asset.csv', c['character_asset_id'])['asset_name'] for c in characters)
    names.update(row('monster_asset.csv', m['monster_asset_id'])['group_name'] for m in monsters)
    files = [one(name) for name in sorted(names)]
    sources = {s['file']: s for s in project['sources']}
    for file in files:
        rel = file.relative_to(source).as_posix()
        sources[rel] = {'file': rel, 'sha256': digest(file), 'bytes': file.stat().st_size}
    sources = sorted(sources.values(), key=lambda s: s['file'])
    for entry in sources:
        if digest(source / entry['file']) != entry['sha256']: raise ValueError('Original source changed')
    table_sources = {}
    master = one('master')
    for path, obj in UnityPy.load(str(master)).container.items():
        if obj.type.name != 'TextAsset' or not path.endswith('.csv'): continue
        name = Path(path).name
        if name in table_sources: raise ValueError('Ambiguous source table: ' + name)
        table_sources[name] = {**source_ref(master.name, path, obj), 'serializedFile': obj.assetsfile.name}
    sprites = {}; assets = {}
    for file in files:
        env = UnityPy.load(str(file))
        for path, obj in sorted(env.container.items(), key=lambda item: (item[0], item[1].type.name, str(item[1].path_id))):
            ref = {**source_ref(file.name, path, obj), 'serializedFile': obj.assetsfile.name}
            if obj.type.name == 'TextAsset' and path.endswith('.json'):
                if path in assets: raise ValueError('Duplicate asset path')
                assets[path] = {'source': ref, 'data': json.loads(obj.read().m_Script)}
            elif obj.type.name == 'Sprite':
                sprite = obj.read()
                picture = full_rect_picture(sprite, path)
                buf = io.BytesIO(); picture.save(buf, format='PNG'); raw = buf.getvalue()
                sha = hashlib.sha256(raw).hexdigest(); target = 'sprites/' + sha + '.png'
                (out / 'sprites').mkdir(exist_ok=True); (out / target).write_bytes(raw)
                if path in sprites: raise ValueError('Duplicate sprite path')
                sprites[path] = {'source': ref, 'name': sprite.m_Name, 'file': target, 'sha256': sha,
                    'representation': 'source-texture-full-rect', 'width': picture.width, 'height': picture.height, 'pivot': [sprite.m_Pivot.x, sprite.m_Pivot.y],
                    **sprite_geometry(sprite, path)}
    for entry in sources:
        if digest(source / entry['file']) != entry['sha256']: raise ValueError('Source changed during export')
    result = {'formatVersion': 1, 'adapterVersion': 'battle-0.3.0', 'parentSourceSetHash': project['sourceSetHash'],
        'characterIds': [int(c['id']) for c in characters],
        'encounterPartyIds': party_ids,
        'sourceSetHash': hashlib.sha256(canonical(sources).encode()).hexdigest(), 'sources': sources,
        'assets': assets, 'sprites': sprites, 'tableSources': table_sources}
    write_json(out / 'battle.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(out).as_posix(), 'sha256': digest(p)} for p in sorted(out.rglob('*')) if p.is_file()]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--character-id', type=int, action='append', default=[],
                        help='Additional source character media identity; repeatable, does not change the party')
    parser.add_argument('--encounter-id', type=int, action='append', default=[],
                        help='Additional source encounter identity; repeatable, does not unlock story content')
    args = parser.parse_args()
    staged = Path(tempfile.mkdtemp(prefix='.battle-', dir=REPO / 'build'))
    target = REPO / 'build/battle'; backup = REPO / 'build/.previous-battle'
    try:
        result = export_battle(args.source.resolve(), staged, args.character_id, args.encounter_id)
        if backup.exists(): raise RuntimeError('Inspect interrupted build/.previous-battle first')
        if target.exists(): target.rename(backup)
        try: staged.rename(target)
        except BaseException:
            if backup.exists(): backup.rename(target)
            raise
        if backup.exists(): shutil.rmtree(backup)
        print(canonical({'sourceSetHash': result['sourceSetHash'], 'sprites': len(result['sprites']),
            'encounterPartyIds': result['encounterPartyIds'],
            'jsonAssets': len(result['assets']), 'output': str(target)}))
    finally:
        if staged.exists(): shutil.rmtree(staged)

if __name__ == '__main__': main()
