"""Export ordinary source SE programs using the existing lossless audio pipeline.

All master rows receive either an exact media entry or an explicit unsupported
program diagnostic. A decoder/integrity failure aborts the staged export; it is
never converted into a passing omission or a first-stream approximation.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from audio_export import decode_stream
from export_environment import SEAD, SEAD_SHA, bank_path
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, source_ref, write_json
from sab import environment_program


def sound_rows(rows):
    seen, result = set(), []
    for row in rows:
        if set(row) != {'id', 'se_name', 'asset_name', 'resident'}:
            raise ValueError('Unexpected SeAsset master columns')
        value = row['id']
        if (not isinstance(value, str) or not value.isascii() or not value.isdecimal() or
                str(int(value)) != value or not 0 < int(value) <= 0x7fffffff or value in seen):
            raise ValueError('Invalid or duplicate SeAsset identity')
        if row['resident'] not in ('0', '1'):
            raise ValueError('Unknown SeAsset resident value')
        bank_path(row)  # Exact existing SEAD path; no BGM platform suffix.
        seen.add(value)
        result.append(dict(row))
    return sorted(result, key=lambda row: int(row['id']))


def decode_sound_bank(raw, program, bank, temp, out):
    """Only a previously validated single-program bank reaches the decoder."""
    bank.write_bytes(raw)
    decoded = decode_stream(bank, temp, out)
    if program['looping'] != (decoded['loop'] is not None):
        raise ValueError('SAB program and decoded material loop disagree')
    return {**decoded, **{key: value for key, value in program.items() if key != 'looping'}}


def export_se(source, out):
    import UnityPy
    imported = checked_snapshot(REPO / 'build/import')
    exported = checked_snapshot(REPO / 'build/corpus')
    project, corpus = json.loads(imported['project.json']), json.loads(exported['corpus.json'])
    if corpus['parentSourceSetHash'] != project['sourceSetHash']:
        raise ValueError('SE import/corpus mismatch')
    for manifest in (project, corpus):
        if hashlib.sha256(canonical(manifest['sources']).encode()).hexdigest() != manifest['sourceSetHash']:
            raise ValueError('Changed SE source manifest')
    table_rows = json.loads(imported['tables.json'])['se_asset.csv']
    rows = sound_rows(table_rows)
    groups = {row['se_name'] for row in rows}
    selected = [s for s in corpus['sources'] if s['file'] == 'GameAssembly.dll' or
                s['file'].endswith('/Metadata/global-metadata.dat') or
                Path(s['file']).name.startswith(tuple([g + '_assets_all_' for g in groups] + ['master_assets_all_']))]
    if len(selected) != len(groups) + 3:
        raise ValueError('Ambiguous SE sources')
    selected.append({'file': SEAD, 'bytes': (source / SEAD).stat().st_size, 'sha256': SEAD_SHA})
    selected.sort(key=lambda item: item['file'])
    for item in selected:
        if digest(source / item['file']) != item['sha256']:
            raise ValueError('Changed SE source')
    master = next(s for s in selected if Path(s['file']).name.startswith('master_assets_all_'))
    tables = [(path, obj) for path, obj in UnityPy.load(str(source / master['file'])).container.items()
              if path.endswith('/se_asset.csv') and obj.type.name == 'TextAsset']
    if len(tables) != 1:
        raise ValueError('Ambiguous SeAsset table')
    table_path, table_object = tables[0]
    if list(csv.DictReader(io.StringIO(table_object.read().m_Script))) != table_rows:
        raise ValueError('SeAsset table does not match locked import')

    def ref(bundle, path, obj):
        return {**source_ref(bundle['file'], path, obj), 'serializedFile': obj.assetsfile.name,
                'sha256': bundle['sha256']}

    banks = {}
    for group in sorted(groups):
        matches = [s for s in selected if Path(s['file']).name.startswith(group + '_assets_all_')]
        if len(matches) != 1:
            raise ValueError('Ambiguous SE bank group')
        bundle = matches[0]
        banks[group] = bundle, dict(UnityPy.load(str(source / bundle['file'])).container)
    tracks, diagnostics = {}, []
    (out / 'tracks').mkdir()
    with tempfile.TemporaryDirectory(prefix='se-decode-', dir=REPO / 'build') as temporary:
        temp = Path(temporary)
        bank = temp / 'source.sab'
        for index, row in enumerate(rows):
            identity, path = row['id'], bank_path(row)
            bundle, container = banks[row['se_name']]
            obj = container.get(path)
            if obj is None or obj.type.name != 'TextAsset':
                raise ValueError('Missing exact SE bank: ' + path)
            raw = obj.read().m_Script.encode('utf-8', 'surrogateescape')
            binding = {'source': ref(bundle, path, obj),
                       'tableSource': {**ref(master, table_path, table_object), 'pointer': '/id/' + identity},
                       'assetName': row['asset_name'], 'group': row['se_name'], 'resident': int(row['resident']),
                       'bankSha256': hashlib.sha256(raw).hexdigest()}
            try:
                program = environment_program(raw)
            except ValueError as error:
                diagnostics.append({'id': int(identity), 'stage': 'program', 'reason': str(error), **binding})
                continue
            # Unsupported substreams, changed decoder versions, failed PCM
            # round trips and inconsistent loops are hard export failures.
            tracks[identity] = {**decode_sound_bank(raw, program, bank, temp, out), **binding}
            if (index + 1) % 50 == 0:
                print(f'Checked {index + 1}/{len(rows)} SE rows; decoded {len(tracks)}, blocked {len(diagnostics)}', flush=True)
    for item in selected:
        if digest(source / item['file']) != item['sha256']:
            raise ValueError('SE source changed during export')
    result = {'formatVersion': 1, 'adapterVersion': 'se-0.1.0',
              'parentSourceSetHash': project['sourceSetHash'], 'corpusSourceSetHash': corpus['sourceSetHash'],
              'sourceSetHash': hashlib.sha256(canonical(selected).encode()).hexdigest(), 'sources': selected,
              'decoder': {'vgmstream': 'r2117', 'ffmpeg': subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0]},
              'masterRows': len(rows), 'tracks': tracks, 'diagnostics': diagnostics,
              'limitations': [
                  'SEAD category mixing, spatial processing, reverb and native sound-instance policies are not reproduced by this media export.',
                  'Unsupported SAB programs have diagnostics and no playable track; multi-stream banks are not flattened.',
                  'Lossless decoding and PCM round-trip checks do not establish original-game audible or timing equivalence.']}
    write_json(out / 'media.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': path.relative_to(out).as_posix(), 'sha256': digest(path)}
        for path in sorted(out.rglob('*')) if path.is_file()]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    staged = Path(tempfile.mkdtemp(prefix='.se-', dir=REPO / 'build'))
    target, backup = REPO / 'build/se', REPO / 'build/.previous-se'
    try:
        result = export_se(args.source.resolve(), staged)
        if backup.exists():
            raise RuntimeError('Inspect interrupted build/.previous-se first')
        if target.exists():
            target.rename(backup)
        try:
            staged.rename(target)
        except BaseException:
            if backup.exists():
                backup.rename(target)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        print(canonical({'rows': result['masterRows'], 'tracks': len(result['tracks']),
                         'blocked': len(result['diagnostics']), 'sourceSetHash': result['sourceSetHash'], 'output': str(target)}))
    finally:
        if staged.exists():
            shutil.rmtree(staged)


if __name__ == '__main__':
    main()
