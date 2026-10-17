"""Validate delivered Opus headers, full decoded frame counts and loop indices."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import struct
import subprocess
from audio import RATE, resampled_frames, write_json


def opus_samples(file):
    """Ogg granule position includes pre-skip; it is not an audible offset."""
    pre_skip, granule = None, 0
    with file.open('rb') as stream:
        while True:
            header = stream.read(27)
            if not header:
                break
            if len(header) != 27 or header[:4] != b'OggS':
                raise ValueError('Invalid Ogg page')
            segments = stream.read(header[26])
            payload = stream.read(sum(segments))
            if payload.startswith(b'OpusHead'):
                pre_skip = struct.unpack_from('<H', payload, 10)[0]
            value = struct.unpack_from('<Q', header, 6)[0]
            if value != 0xffffffffffffffff:
                granule = value
    if pre_skip is None:
        raise ValueError('No OpusHead')
    return pre_skip, granule - pre_skip


def validate(out, report):
    audio = json.loads((out/'audio.json').read_text())
    requests = [(kind, id, track) for kind in ['bgm', 'se'] for id, track in audio[kind]['tracks'].items()]
    def check(request):
        kind, id, track = request
        file = out/track['file'].removeprefix('/web-data/')
        errors = []
        info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
            'stream=codec_name,sample_rate,channels', '-of', 'json', str(file)], text=True))['streams'][0]
        if info['codec_name'] != 'opus' or int(info['sample_rate']) != RATE or info['channels'] != track['channels']:
            errors.append('Incorrect codec/rate/channels')
        process = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', str(file), '-map', '0:a:0',
            '-f', 's16le', '-c:a', 'pcm_s16le', '-'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        count = 0
        for block in iter(lambda: process.stdout.read(1024*1024), b''):
            count += len(block)
        failure = process.stderr.read().decode()
        if process.wait():
            errors.append(f'Decode failed: {failure}')
        decoded = count // (2*track['channels'])
        expected = resampled_frames(track['sourceFrames'], track['sourceSampleRate'])
        pre_skip, granule_frames = opus_samples(file)
        if abs(decoded-expected) > 1 or granule_frames != decoded or abs(track['frames']-decoded) > 1:
            errors.append(f'Decoded length mismatch: {decoded}, expected {expected}, granule {granule_frames}')
        loop = track.get('loop')
        if loop:
            if not 0 <= loop['start'] < loop['end'] <= decoded + 1:
                errors.append('Loop exceeds decoded audio')
            if loop['start'] != resampled_frames(loop['sourceStart'], loop['sourceSampleRate']) or loop['end'] != resampled_frames(loop['sourceEnd'], loop['sourceSampleRate']):
                errors.append('Incorrect resampled loop')
            if loop['startSeconds'] != loop['sourceStart']/loop['sourceSampleRate'] or loop['endSeconds'] != loop['sourceEnd']/loop['sourceSampleRate']:
                errors.append('Incorrect exact loop seconds')
        return {'kind': kind, 'id': int(id), 'file': track['file'], 'bytes': file.stat().st_size,
                'expectedFrames': expected, 'decodedFrames': decoded, 'preSkip': pre_skip,
                'granuleContentFrames': granule_frames, 'loop': loop, 'errors': errors}
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(check, requests))
    profile = json.loads((out/'audio-profile.json').read_text())
    failures = [row for row in rows if row['errors']]
    result = {'profile': profile['profile'], 'tracks': len(rows), 'passed': len(rows)-len(failures),
              'failed': len(failures), 'loopTracks': sum(bool(r['loop']) for r in rows),
              'maximumFrameDifference': max(abs(r['expectedFrames']-r['decodedFrames']) for r in rows),
              'oldFlacFiles': len(list((out/'audio').glob('*.flac'))),
              'bytes': {kind: sum(r['bytes'] for r in rows if r['kind']==kind) for kind in ['bgm', 'se']},
              'usage': profile['usage'], 'failures': failures, 'tracksChecked': rows,
              'interpretation': 'Full FFmpeg decode and Ogg granule/pre-skip agree; pre-skip was not added to content or loop offsets. Source-to-48k resampling allows one sample of rounding. Browser decode, playback and audible loop transitions require the separate browser checks.'}
    write_json(report, result)
    print(json.dumps({key: result[key] for key in ['tracks', 'passed', 'failed', 'loopTracks', 'maximumFrameDifference', 'oldFlacFiles', 'bytes']}, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--report', type=Path, default=Path('build/play/foundation-audio-validation.json'))
    args = parser.parse_args()
    validate(args.out, args.report)
