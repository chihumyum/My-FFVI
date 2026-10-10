"""Decode a single source audio stream and verify lossless browser media output."""
from __future__ import annotations
import hashlib
import json
import shutil
import subprocess
import wave
from import_source import digest


def stream_metadata(raw):
    if raw.get('version') != 'r2117' or raw.get('streamInfo', {}).get('total') != 1:
        raise ValueError('Unreviewed decoder or multi-stream audio')
    rate, frames, channels = (raw[k] for k in ('sampleRate', 'numberOfSamples', 'channels'))
    if any(type(n) is not int or n <= 0 for n in (rate, frames, channels)) or channels > 2:
        raise ValueError('Unsupported audio stream geometry')
    loop = raw['loopingInfo']
    if loop is not None and (set(loop) != {'start', 'end'} or
            any(type(n) is not int for n in loop.values()) or
            not 0 <= loop['start'] < loop['end'] <= frames):
        raise ValueError('Invalid audio sample loop')
    return {'sampleRate': rate, 'frames': frames, 'channels': channels, 'loop': loop,
            'codec': raw['encoding'], 'streamName': raw['streamInfo']['name']}


def decode_stream(bank, temp, out):
    pcm = temp / "stream.wav"
    flac = temp / "stream.flac"
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
    if hashlib.sha256(restored).hexdigest() != pcm_hash: raise ValueError('Audio PCM round trip changed')
    sha = digest(flac); relative = 'tracks/' + sha + '.flac'
    shutil.copyfile(flac, out / relative)
    return {**meta, "file": relative, "sha256": sha, "pcmSha256": pcm_hash}
