"""Export all environment sound banks referenced by the locked source script corpus."""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile
from audio_export import decode_stream
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, source_ref, write_json
from sab import environment_program

SEAD = 'FINAL FANTASY VI_Data/Plugins/x86_64/sead.dll'
SEAD_SHA = '8607d832df2e1b359bc4bd45c5cbea859024091ce8b1b16726954a07b3630735'


def bank_path(row):
    name, group = row['asset_name'], row['se_name']
    if (PurePosixPath(name).name != name or '\\' in name or not name.endswith('.sab') or
            not group or not all(c.isascii() and (c.isalnum() or c == '_') for c in group)):
        raise ValueError('Unsafe environment bank path')
    return 'Assets/GameAssets/Common/Res/Audio/' + group + '/' + name + '.bytes'


def export_environment(source, out):
    import UnityPy
    imported = checked_snapshot(REPO / 'build/import')
    exported = checked_snapshot(REPO / 'build/corpus')
    project, corpus = json.loads(imported['project.json']), json.loads(exported['corpus.json'])
    if corpus['parentSourceSetHash'] != project['sourceSetHash']:
        raise ValueError('Environment import/corpus mismatch')
    for manifest in (project, corpus):
        if hashlib.sha256(canonical(manifest['sources']).encode()).hexdigest() != manifest['sourceSetHash']:
            raise ValueError('Changed environment source manifest')
    requests = {}
    for bundle in corpus['bundles']:
        if not bundle['scripts']: continue
        for asset in json.loads(exported[bundle['output']]):
            if asset['kind'] != 'script': continue
            for index, op in enumerate(asset['data']['Mnemonics']):
                if op['mnemonic'] != 'PlayEnvSe': continue
                track = str(int(op['operands']['iValues'][0]))
                requests.setdefault(track, []).append({**asset['source'], 'pointer': '/Mnemonics/' + str(index)})
    table_rows = json.loads(imported['tables.json'])['se_asset.csv']
    rows = [r for r in table_rows if str(int(r['id'])) in requests]
    if len(rows) != len(requests) or len({int(r['id']) for r in rows}) != len(rows):
        raise ValueError('Missing or duplicate environment master ID')
    groups = {r['se_name'] for r in rows}
    selected = [s for s in corpus['sources'] if s['file'] == 'GameAssembly.dll' or
                s['file'].endswith('/Metadata/global-metadata.dat') or
                Path(s['file']).name.startswith(tuple([g + '_assets_all_' for g in groups] + ['master_assets_all_']))]
    if len(selected) != len(groups) + 3: raise ValueError('Ambiguous environment sources')
    selected.append({'file': SEAD, 'bytes': (source / SEAD).stat().st_size, 'sha256': SEAD_SHA})
    selected.sort(key=lambda s: s['file'])
    for s in selected:
        if digest(source / s['file']) != s['sha256']: raise ValueError('Changed environment source')
    master = next(s for s in selected if Path(s['file']).name.startswith('master_assets_all_'))
    candidates = [(p, o) for p, o in UnityPy.load(str(source / master['file'])).container.items()
                  if p.endswith('/se_asset.csv') and o.type.name == 'TextAsset']
    if len(candidates) != 1: raise ValueError('Ambiguous SeAsset table')
    table_path, table_object = candidates[0]
    if list(csv.DictReader(io.StringIO(table_object.read().m_Script))) != table_rows:
        raise ValueError('SeAsset table does not match locked import')

    def ref(bundle, path, obj):
        return {**source_ref(bundle['file'], path, obj), 'serializedFile': obj.assetsfile.name,
                'sha256': bundle['sha256']}

    banks = {}
    for group in sorted(groups):
        bundle = next(s for s in selected if Path(s['file']).name.startswith(group + '_assets_all_'))
        banks[group] = bundle, dict(UnityPy.load(str(source / bundle['file'])).container)
    tracks = {}; (out / 'tracks').mkdir()
    with tempfile.TemporaryDirectory(prefix='environment-decode-', dir=REPO / 'build') as tmp:
        temp = Path(tmp); bank = temp / 'source.sab'
        for row in sorted(rows, key=lambda r: int(r['id'])):
            track_id, path = str(int(row['id'])), bank_path(row)
            bundle, container = banks[row['se_name']]
            obj = container.get(path)
            if obj is None or obj.type.name != 'TextAsset': raise ValueError('Missing exact environment bank')
            raw = obj.read().m_Script.encode('utf-8', 'surrogateescape'); bank.write_bytes(raw)
            program = environment_program(raw)
            decoded = decode_stream(bank, temp, out)
            if program.pop('looping') != (decoded['loop'] is not None):
                raise ValueError('SAB program and material loop disagree')
            tracks[track_id] = {**decoded, **program, 'bankSha256': hashlib.sha256(raw).hexdigest(),
                'source': ref(bundle, path, obj),
                'tableSource': {**ref(master, table_path, table_object), 'pointer': '/id/' + track_id},
                'requests': requests[track_id], 'assetName': row['asset_name']}
    for s in selected:
        if digest(source / s['file']) != s['sha256']: raise ValueError('Environment source changed during export')
    result = {'formatVersion': 1, 'adapterVersion': 'environment-0.1.0',
              'parentSourceSetHash': project['sourceSetHash'], 'corpusSourceSetHash': corpus['sourceSetHash'],
              'sourceSetHash': hashlib.sha256(canonical(selected).encode()).hexdigest(), 'sources': selected,
              'decoder': {'vgmstream': 'r2117', 'ffmpeg': subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0]},
              'tracks': tracks,
              'limitations': ['SEAD category mixing, sound start/end macros, spatial processing and reverb are not reproduced.']}
    write_json(out / 'media.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(out).as_posix(), 'sha256': digest(p)} for p in sorted(out.rglob('*')) if p.is_file()]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    staged = Path(tempfile.mkdtemp(prefix='.environment-', dir=REPO / 'build'))
    target, backup = REPO / 'build/environment', REPO / 'build/.previous-environment'
    try:
        result = export_environment(args.source.resolve(), staged)
        if backup.exists(): raise RuntimeError('Inspect interrupted build/.previous-environment first')
        if target.exists(): target.rename(backup)
        try: staged.rename(target)
        except BaseException:
            if backup.exists(): backup.rename(target)
            raise
        if backup.exists(): shutil.rmtree(backup)
        print(canonical({'tracks': len(result['tracks']), 'sourceSetHash': result['sourceSetHash'], 'output': str(target)}))
    finally:
        if staged.exists(): shutil.rmtree(staged)


if __name__ == '__main__': main()
