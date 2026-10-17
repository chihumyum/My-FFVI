"""Export source TimeManager settings with their built-in object identity."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'source_adapter'))
from export_field import checked_snapshot
from import_source import REPO, canonical, digest, write_json


def clock_values(tree: dict) -> dict:
    names = {'fixedTimestep': 'Fixed Timestep', 'maximumTimestep': 'Maximum Allowed Timestep',
             'timeScale': 'm_TimeScale', 'maximumParticleTimestep': 'Maximum Particle Timestep'}
    result = {}
    for name, key in names.items():
        value = tree[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError('Invalid source TimeManager number: ' + key)
        if value <= 0:
            raise ValueError('Unsupported nonpositive initial TimeManager value: ' + key)
        result[name] = value
    if result['maximumTimestep'] < result['fixedTimestep'] or result['maximumParticleTimestep'] < result['fixedTimestep']:
        raise ValueError('TimeManager settings require an additional native normalization path')
    return result


def export_clock(source: Path, output: Path):
    import UnityPy
    corpus = json.loads(checked_snapshot(REPO / 'build/corpus')['corpus.json'])
    if hashlib.sha256(canonical(corpus['sources']).encode()).hexdigest() != corpus['sourceSetHash']:
        raise ValueError('Corpus source manifest changed')
    file = 'FINAL FANTASY VI_Data/globalgamemanagers'
    before = digest(source / file)
    env = UnityPy.load(str(source / file))
    clocks = [o for o in env.objects if o.type.name == 'TimeManager']
    if len(clocks) != 1:
        raise ValueError('Missing or ambiguous TimeManager source object')
    clock = clocks[0]
    if clock.assets_file.unity_version != '2019.4.20f1':
        raise ValueError('Unexpected TimeManager Unity version')
    sources = [{'file': file, 'sha256': before}]
    result = {'formatVersion': 1, 'adapterVersion': 'field-particle-clock-0.1.0',
              'parentSourceSetHash': corpus['sourceSetHash'], 'sources': sources,
              'sourceSetHash': hashlib.sha256(canonical(sources).encode()).hexdigest(),
              'timeManager': {'type': 'TimeManager', 'source': {**sources[0],
                  'serializedFile': clock.assets_file.name, 'objectId': str(clock.path_id)},
                  'values': clock_values(clock.read_typetree())}}
    if digest(source / file) != before:
        raise ValueError('TimeManager source changed during export')
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / 'clock.json', result)
    write_json(output / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': 'clock.json', 'sha256': digest(output / 'clock.json')}]})
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = export_clock(args.source.resolve(), args.output.resolve())
    print(canonical({'sourceSetHash': result['sourceSetHash'], 'timeManager': result['timeManager']}))
