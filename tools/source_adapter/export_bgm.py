"""Export exact BgmAsset rows and their Windows MAB streams, preserving sample loop points."""
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
import wave
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, source_ref, write_json


def platform_name(name):
    """BgmAsset.PlatformAssetName, Windows source profile (0x142CDB0)."""
    p = PurePosixPath(name)
    if p.name != name or '\\' in name or p.suffix != '.mab' or name.count('.') != 1:
        raise ValueError('Unsupported BGM asset name')
    return p.stem + '.win.mab.bytes'


def stream_metadata(raw):
    if raw.get('version') != 'r2117' or raw.get('streamInfo', {}).get('total') != 1:
        raise ValueError('Unreviewed decoder or multi-stream BGM')
    rate, frames, channels = (raw[k] for k in ('sampleRate', 'numberOfSamples', 'channels'))
    if any(type(n) is not int or n <= 0 for n in (rate, frames, channels)) or channels > 2:
        raise ValueError('Unsupported BGM stream geometry')
    loop = raw['loopingInfo']
    if loop is not None and (set(loop) != {'start', 'end'} or
            any(type(n) is not int for n in loop.values()) or
            not 0 <= loop['start'] < loop['end'] <= frames):
        raise ValueError('Invalid BGM sample loop')
    return {'sampleRate': rate, 'frames': frames, 'channels': channels, 'loop': loop,
            'codec': raw['encoding'], 'streamName': raw['streamInfo']['name']}


def export_bgm(source, out):
    import UnityPy
    imported = checked_snapshot(REPO / 'build/import')
    project = json.loads(imported['project.json'])
    corpus = json.loads(checked_snapshot(REPO / 'build/corpus')['corpus.json'])
    if corpus['parentSourceSetHash'] != project['sourceSetHash']:
        raise ValueError('BGM import/corpus mismatch')
    for m in (project, corpus):
        if hashlib.sha256(canonical(m['sources']).encode()).hexdigest() != m['sourceSetHash']:
            raise ValueError('Changed BGM source manifest')
    selected = [s for s in corpus['sources'] if s['file'] == 'GameAssembly.dll' or
                s['file'].endswith('/Metadata/global-metadata.dat') or
                Path(s['file']).name.startswith(('master_assets_all_', 'ff6_bgm_assets_all_'))]
    if len(selected) != 4: raise ValueError('Ambiguous BGM sources')
    selected.sort(key=lambda s: s['file'])
    for s in selected:
        if digest(source / s['file']) != s['sha256']: raise ValueError('Changed BGM source')
    master = next(s for s in selected if Path(s['file']).name.startswith('master_assets_all_'))
    music = next(s for s in selected if Path(s['file']).name.startswith('ff6_bgm_assets_all_'))
    candidates = [(p, o) for p, o in UnityPy.load(str(source / master['file'])).container.items()
                  if p.endswith('/bgm_asset.csv') and o.type.name == 'TextAsset']
    if len(candidates) != 1: raise ValueError('Ambiguous BgmAsset table')
    table_path, table_object = candidates[0]
    rows = list(csv.DictReader(io.StringIO(table_object.read().m_Script)))
    if rows != json.loads(imported['tables.json'])['bgm_asset.csv']:
        raise ValueError('BgmAsset table does not match locked import')

    def ref(bundle, path, obj):
        return {**source_ref(bundle['file'], path, obj), 'serializedFile': obj.assetsfile.name,
                'sha256': bundle['sha256']}

    table_source = ref(master, table_path, table_object)
    env = UnityPy.load(str(source / music['file']))
    container = dict(env.container)
    ffmpeg_version = subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0]
    tracks = {}; (out / 'tracks').mkdir()
    with tempfile.TemporaryDirectory(prefix='bgm-decode-', dir=REPO / 'build') as tmp:
        temp = Path(tmp); bank = temp / 'source.mab'; pcm = temp / 'stream.wav'; flac = temp / 'stream.flac'
        for n, row in enumerate(sorted(rows, key=lambda r: int(r['id']))):
            track_id = str(int(row['id']))
            if int(track_id) <= 0 or track_id in tracks or row['bgm_name'] != 'ff6_bgm':
                raise ValueError('Ambiguous BGM row')
            path = 'Assets/GameAssets/Serial/Res/Audio/' + row['bgm_name'] + '/' + platform_name(row['asset_name'])
            obj = container.get(path)
            if obj is None or obj.type.name != 'TextAsset': raise ValueError('Missing exact BGM bank: ' + path)
            raw = obj.read().m_Script.encode('utf-8', 'surrogateescape')
            bank.write_bytes(raw)
            details = json.loads(subprocess.check_output(['vgmstream-cli', '-m', '-I', str(bank)], text=True))
            meta = stream_metadata(details)
            subprocess.run(['vgmstream-cli', '-i', '-W', '1', '-o', str(pcm), str(bank)],
                           check=True, stdout=subprocess.DEVNULL)
            with wave.open(str(pcm), 'rb') as wav:
                if (wav.getframerate(), wav.getnframes(), wav.getnchannels(), wav.getsampwidth()) != (
                        meta['sampleRate'], meta['frames'], meta['channels'], 2):
                    raise ValueError('Decoded sample geometry changed')
                pcm_hash = hashlib.sha256(wav.readframes(meta['frames'])).hexdigest()
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(pcm), '-map_metadata', '-1',
                            '-fflags', '+bitexact', '-flags:a', '+bitexact', '-c:a', 'flac',
                            '-compression_level', '5', str(flac)], check=True)
            # Confirm that compression preserves every decoded sample, without retaining full WAVs.
            restored = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(flac), '-f', 's16le', '-'])
            if hashlib.sha256(restored).hexdigest() != pcm_hash: raise ValueError('BGM PCM round trip changed')
            sha = digest(flac); relative = 'tracks/' + sha + '.flac'
            shutil.copyfile(flac, out / relative)
            tracks[track_id] = {**meta, 'file': relative, 'sha256': sha, 'pcmSha256': pcm_hash,
                'bankSha256': hashlib.sha256(raw).hexdigest(), 'source': ref(music, path, obj),
                'tableSource': {**table_source, 'pointer': '/id/' + track_id}, 'assetName': row['asset_name']}
            if (n + 1) % 10 == 0: print(f'Decoded and verified {n + 1}/{len(rows)} BGM tracks', flush=True)
    for s in selected:
        if digest(source / s['file']) != s['sha256']: raise ValueError('BGM source changed during export')
    result = {'formatVersion': 1, 'adapterVersion': 'bgm-0.1.0',
              'parentSourceSetHash': project['sourceSetHash'], 'corpusSourceSetHash': corpus['sourceSetHash'],
              'sourceSetHash': hashlib.sha256(canonical(selected).encode()).hexdigest(), 'sources': selected,
              'decoder': {'vgmstream': 'r2117', 'ffmpeg': ffmpeg_version}, 'tracks': tracks}
    write_json(out / 'media.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': p.relative_to(out).as_posix(), 'sha256': digest(p)} for p in sorted(out.rglob('*')) if p.is_file()]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    args = parser.parse_args()
    staged = Path(tempfile.mkdtemp(prefix='.bgm-', dir=REPO / 'build'))
    target = REPO / 'build/bgm'; backup = REPO / 'build/.previous-bgm'
    try:
        result = export_bgm(args.source.resolve(), staged)
        if backup.exists(): raise RuntimeError('Inspect interrupted build/.previous-bgm first')
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
