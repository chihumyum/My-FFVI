"""Original SEAD bank -> one-pass PCM -> 48 kHz Ogg Opus; --aac is optional.

Only audio/ delivery artifacts are disposable. Original banks stay in media/.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import wave
from sab import environment_program

RATE = 48000
PROFILES = {'bgm': {'bitrate': 48000, 'channels': 2}, 'se': {'bitrate': 64000}}


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
    temporary.replace(path)


def resampled_frames(frames, rate):
    return (int(frames) * RATE + int(rate) // 2) // int(rate)


def loop_metadata(metadata, program, warnings):
    source_rate, frames = metadata['sampleRate'], metadata['numberOfSamples']
    loop = metadata.get('loopingInfo')
    if not loop and program.get('looping'):
        loop = {'start': 0, 'end': frames}
        warnings.append('SEAD sequence requests looping but decoded HCA has no loop points; using the whole decoded stream.')
    if not loop:
        return None
    start, end = int(loop['start']), int(loop['end'])
    if not 0 <= start < end <= frames:
        warnings.append(f'Invalid source loop [{start},{end}) for {frames} samples; looping disabled.')
        return None
    return {'start': resampled_frames(start, source_rate), 'end': resampled_frames(end, source_rate),
            'sampleRate': RATE, 'startSeconds': start/source_rate, 'endSeconds': end/source_rate,
            'sourceStart': start, 'sourceEnd': end, 'sourceSampleRate': source_rate}


def usage_sets(out, tables, result):
    source = set(result['bgm']['tracks'])
    music = {r['bgm_asset_id'].strip() for r in tables.get('sound_player_list.csv', [])}
    maps = {r['bgm_id'].strip() for r in tables.get('map.csv', [])}
    battles = {r['battle_bgm_asset_id'].strip() for r in tables.get('monster_party.csv', [])}
    scripts = set()
    index = json.loads((out/'raw/index.json').read_text())
    for record in index['files']:
        if not record.get('bundleOutput'):
            continue
        for asset in json.loads((out/record['bundleOutput']).read_text()):
            if not isinstance(asset['data'], dict):
                continue
            for op in asset['data'].get('Mnemonics', []):
                if op['mnemonic'] in {'PlayBGM', 'ReplayBgm'}:
                    values = op.get('operands', {}).get('iValues', [])
                    if values and values[0] > 0:
                        scripts.add(str(values[0]))
    def summarize(ids):
        ids = source & ids
        tracks = [result['bgm']['tracks'][id] for id in ids]
        seconds = sum(t['durationSeconds'] for t in tracks)
        return {'ids': sorted(map(int, ids)), 'tracks': len(ids), 'seconds': seconds,
                'bytes': sum((out/t['file'].removeprefix('/web-data/')).stat().st_size for t in tracks),
                'targetBitrate': PROFILES['bgm']['bitrate'],
                'theoreticalBytesAtTargetBitrate': seconds * PROFILES['bgm']['bitrate'] / 8}
    return {'source': summarize(source), 'musicPlayer': summarize(music),
            'gameplayReferenced': summarize(maps | battles | scripts),
            'references': {'maps': sorted(map(int, source & maps)), 'battles': sorted(map(int, source & battles)),
                           'programs': sorted(map(int, source & scripts))},
            'note': 'gameplayReferenced is a static superset from map.bgm_id, monster_party.battle_bgm_asset_id and PR PlayBGM/ReplayBgm operands, not an observed playthrough set. Dynamic saved-BGM replays add no literal ID. All source tracks remain delivered.'}


def export(out, aac=False):
    for tool in ['vgmstream-cli', 'ffmpeg']:
        if not shutil.which(tool):
            raise RuntimeError(f'Missing {tool}')
    encoders = subprocess.check_output(['ffmpeg', '-hide_banner', '-encoders'], text=True, stderr=subprocess.DEVNULL)
    if 'libopus' not in encoders:
        raise RuntimeError('This FFmpeg build has no libopus encoder')
    tables = json.loads((out/'raw/tables.json').read_text())
    media = json.loads((out/'raw/media.json').read_text())
    banks = {path.lower(): row for row in media['audio'] for path in row['source'].get('assetPaths', [row['source'].get('assetPath')]) if path}
    decoder = json.loads(subprocess.run(['vgmstream-cli', '-V'], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout)['version']
    ffmpeg_version = subprocess.check_output(['ffmpeg', '-version'], text=True)
    helpers = Path(__file__).read_bytes() + Path(__file__).with_name('sab.py').read_bytes()
    config = {'version': 'opus-2-compact-bgm', 'sampleRate': RATE, 'profiles': PROFILES, 'vbr': {'bgm': 'constrained', 'se': 'on'},
              'application': 'audio', 'frameDurationMs': 20, 'compressionLevel': 10, 'aac': aac}
    profile = json.dumps(config, sort_keys=True).encode() + decoder.encode() + ffmpeg_version.encode() + hashlib.sha256(helpers).digest()
    requests = []
    for kind, name in [('bgm', 'bgm_asset.csv'), ('se', 'se_asset.csv')]:
        for raw in tables.get(name, []):
            row = {key: value.strip() if isinstance(value, str) else value for key, value in raw.items()}
            asset = row['asset_name']
            location = (f"Assets/GameAssets/Serial/Res/Audio/{row['bgm_name']}/{Path(asset).stem}.win.mab.bytes" if kind == 'bgm'
                        else f"Assets/GameAssets/Common/Res/Audio/{row['se_name']}/{asset}.bytes")
            bank = banks.get(location.lower())
            if not bank:
                raise ValueError(f'Missing original audio bank {location}')
            requests.append((kind, row, bank))
    cached = []

    def decode(request):
        kind, row, bank = request
        source = out/bank['url']
        raw = source.read_bytes()
        key = hashlib.sha256(raw + kind.encode() + profile).hexdigest()
        cache = out/'.cache/audio'/f'{key}.json'
        if cache.exists():
            previous = json.loads(cache.read_text())
            if all((out/file).is_file() for file in previous['outputs']):
                cached.append(key)
                return kind, row['id'], {**previous['track'], 'assetName': row['asset_name']}
        warnings, program = [], {}
        if kind == 'se':
            try:
                program = environment_program(raw)
                program.pop('program', None)
            except ValueError as error:
                warnings.append(f'SAB mixer not fully interpreted: {error}; first decoded stream retained.')
        with tempfile.TemporaryDirectory(prefix='ffvi-audio-') as directory:
            bank_file = Path(directory)/('source.mab' if kind == 'bgm' else 'source.sab')
            bank_file.write_bytes(raw)
            metadata = json.loads(subprocess.check_output(['vgmstream-cli', '-m', '-I', str(bank_file)], text=True))
            wav = Path(directory)/'source.wav'
            subprocess.run(['vgmstream-cli', '-i', '-W', '1', '-o', str(wav), str(bank_file)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            with wave.open(str(wav)) as pcm:
                pcm_frames, pcm_rate, pcm_channels = pcm.getnframes(), pcm.getframerate(), pcm.getnchannels()
            if pcm_frames != metadata['numberOfSamples'] or pcm_rate != metadata['sampleRate']:
                raise ValueError(f'{row["asset_name"]}: PCM length/rate differs from source metadata')
            channels = PROFILES[kind].get('channels', pcm_channels)
            relative = f'audio/{key}.opus'
            target = out/relative
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix('.tmp.opus')
            options = ['-ar', str(RATE), '-ac', str(channels)]
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-map_metadata', '-1',
                            *options, '-c:a', 'libopus', '-b:a', str(PROFILES[kind]['bitrate']),
                            '-vbr', config['vbr'][kind], '-application', 'audio', '-frame_duration', '20',
                            '-compression_level', '10', str(temporary)], check=True)
            temporary.replace(target)
            outputs = [relative]
            fallback = None
            if aac:
                aac_relative = f'audio/{key}.m4a'
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-map_metadata', '-1', *options,
                                '-c:a', 'aac', '-b:a', str(PROFILES[kind]['bitrate']), '-movflags', '+faststart', str(out/aac_relative)], check=True)
                outputs.append(aac_relative)
                fallback = {'file': '/web-data/'+aac_relative, 'codec': 'aac', 'mimeType': 'audio/mp4; codecs=mp4a.40.2'}
        loop = loop_metadata(metadata, program, warnings)
        track = {'file': '/web-data/'+relative, 'codec': 'opus', 'mimeType': 'audio/ogg; codecs=opus',
                 'sampleRate': RATE, 'frames': resampled_frames(pcm_frames, pcm_rate), 'channels': channels,
                 'durationSeconds': pcm_frames/pcm_rate, 'sourceSampleRate': pcm_rate, 'sourceFrames': pcm_frames,
                 'sourceChannels': pcm_channels, 'sourceCodec': metadata['encoding'],
                 'sourceLoop': metadata.get('loopingInfo'), 'loop': loop, 'assetName': row['asset_name'],
                 **program, 'looping': bool(loop), 'warnings': warnings}
        if warnings:
            track['warning'] = ' '.join(warnings)
        if fallback:
            track['fallback'] = fallback
        write_json(cache, {'outputs': outputs, 'track': track})
        return kind, row['id'], track

    result = {kind: {'tracks': {}} for kind in ['bgm', 'se', 'environment']}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for index, (kind, id, track) in enumerate(pool.map(decode, requests)):
            result[kind]['tracks'][id] = track
            if kind == 'se':
                result['environment']['tracks'][id] = track
            if (index+1) % 50 == 0:
                print(f'Audio {index+1}/{len(requests)} ({len(cached)} cached)', flush=True)
    used = {track['file'].removeprefix('/web-data/') for catalog in result.values() for track in catalog['tracks'].values()}
    used |= {track['fallback']['file'].removeprefix('/web-data/') for catalog in result.values() for track in catalog['tracks'].values() if track.get('fallback')}
    for pattern in ['*.flac', '*.opus', '*.m4a']:
        for file in (out/'audio').glob(pattern):
            if file.relative_to(out).as_posix() not in used:
                file.unlink()
    write_json(out/'audio.json', result)
    summary = {'profile': config, 'decoder': decoder, 'ffmpeg': ffmpeg_version.splitlines()[0],
               'tracks': len(requests), 'cached': len(cached), 'warnings': sum(bool(t['warnings']) for catalog in [result['bgm'], result['se']] for t in catalog['tracks'].values()),
               'usage': usage_sets(out, tables, result)}
    if summary['usage']['source']['bytes'] > 100_000_000:
        raise RuntimeError('Delivered Opus music exceeds the 100 MB budget; adjust the BGM encoding profile.')
    write_json(out/'audio-profile.json', summary)
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--aac', action='store_true', help='Also generate an AAC fallback after browser capability testing')
    args = parser.parse_args()
    export(args.out, args.aac)
