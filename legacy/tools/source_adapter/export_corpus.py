"""Index JSON content from every Addressables bundle, without exporting media pixels."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
from import_source import REPO, canonical, digest, source_ref, write_json
from export_field import checked_snapshot


def classify_json(data):
    if isinstance(data, dict) and isinstance(data.get('Mnemonics'), list):
        return 'script'
    if isinstance(data, dict) and isinstance(data.get('map'), list) and 'asset_group_name' in data:
        return 'map-package'
    return 'data'


def export_corpus(source: Path, out: Path):
    import UnityPy
    parent = checked_snapshot(REPO / 'build/import')
    project = json.loads(parent['project.json'])
    if hashlib.sha256(canonical(project['sources']).encode()).hexdigest() != project['sourceSetHash']:
        raise ValueError('Base source manifest changed')
    bundle_root = source / 'FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64'
    bundle_files = sorted(bundle_root.glob('*.bundle'))
    if not bundle_files:
        raise ValueError('No Addressables bundles')
    paths = sorted(set(bundle_files + [source / s['file'] for s in project['sources']]))
    sources = [{'file': p.relative_to(source).as_posix(), 'sha256': digest(p), 'bytes': p.stat().st_size} for p in paths]
    by_file = {s['file']: s for s in sources}
    for s in project['sources']:
        if by_file.get(s['file']) != s:
            raise ValueError('Corpus and parent source differ: ' + s['file'])
    bundles = []
    unaddressed = []
    null_entries = []
    messages = {}
    for index, file in enumerate(bundle_files):
        env = UnityPy.load(str(file))
        assets = []
        addressed = set()
        for path, obj in sorted(env.container.items(), key=lambda kv: (kv[0], str(kv[1].path_id))):
            if obj.path_id == 0:
                null_entries.append({'file': file.name, 'assetPath': path, 'objectId': '0'})
                continue
            if obj.type.name != 'TextAsset':
                continue
            addressed.add((obj.assetsfile.name, str(obj.path_id)))
            ref = {**source_ref(file.relative_to(source).as_posix(), path, obj),
                   'serializedFile': obj.assetsfile.name, 'sha256': by_file[file.relative_to(source).as_posix()]['sha256']}
            if path.endswith('.json'):
                data = json.loads(obj.read().m_Script)
                assets.append({'id': file.name + '::' + path, 'source': ref, 'kind': classify_json(data), 'data': data})
            elif Path(path).name in {'story_mes_zhc.txt', 'story_cha_zhc.txt'}:
                name = Path(path).stem
                if name in messages: raise ValueError('Duplicate message table: ' + name)
                messages[name] = {'source': ref, 'values': dict(line.split('\t', 1) for line in obj.read().m_Script.splitlines() if '\t' in line)}
        # These objects are not assumed absent just because the container omitted them.
        for obj in env.objects:
            if obj.type.name == 'TextAsset' and (obj.assets_file.name, str(obj.path_id)) not in addressed:
                unaddressed.append({'file': file.name, 'serializedFile': obj.assets_file.name, 'objectId': str(obj.path_id)})
        output = 'bundles/' + file.stem + '.json' if assets else None
        if output: write_json(out / output, assets)
        bundles.append({'file': file.relative_to(source).as_posix(), 'output': output,
                        'jsonAssets': len(assets), 'scripts': sum(a['kind'] == 'script' for a in assets)})
        if (index + 1) % 250 == 0:
            print(f'Indexed {index + 1}/{len(bundle_files)} bundles', file=sys.stderr, flush=True)
    for p, s in zip(paths, sources):
        if digest(p) != s['sha256']: raise ValueError('Source changed during corpus export: ' + s['file'])
    result = {'formatVersion': 1, 'adapterVersion': 'corpus-0.1.0', 'parentSourceSetHash': project['sourceSetHash'],
              'sourceSetHash': hashlib.sha256(canonical(sources).encode()).hexdigest(), 'sources': sources,
              'bundles': bundles, 'unaddressedTextAssets': unaddressed, 'nullContainerEntries': null_entries,
              'scope': 'All supplied Addressables bundle containers; JSON and script text only. Media decoding and runtime coverage are separate.'}
    write_json(out / 'corpus.json', result)
    write_json(out / 'messages.json', messages)
    (out / 'tables.json').write_bytes(parent['tables.json'])
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(out).as_posix(), 'sha256': digest(p)} for p in sorted(out.rglob('*')) if p.is_file()]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    staged = Path(tempfile.mkdtemp(prefix='.corpus-', dir=REPO / 'build'))
    target = REPO / 'build/corpus'; backup = REPO / 'build/.previous-corpus'
    try:
        result = export_corpus(args.source.resolve(), staged)
        if backup.exists(): raise RuntimeError('Inspect interrupted build/.previous-corpus first')
        if target.exists(): target.rename(backup)
        try: staged.rename(target)
        except BaseException:
            if backup.exists(): backup.rename(target)
            raise
        if backup.exists(): shutil.rmtree(backup)
        print(canonical({'sourceSetHash': result['sourceSetHash'], 'bundles': len(result['bundles']),
                         'jsonAssets': sum(b['jsonAssets'] for b in result['bundles']),
                         'scripts': sum(b['scripts'] for b in result['bundles']),
                         'unaddressedTextAssets': len(result['unaddressedTextAssets']), 'output': str(target)}))
    finally:
        if staged.exists(): shutil.rmtree(staged)


if __name__ == '__main__': main()
