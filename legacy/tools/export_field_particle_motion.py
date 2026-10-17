"""Export the source 3D PhysicsManager gravity for native particle motion."""
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


def gravity_values(tree: dict) -> dict:
    result = tree['m_Gravity']
    if not isinstance(result, dict) or set(result) != {'x', 'y', 'z'}:
        raise ValueError('Invalid source PhysicsManager gravity')
    for value in result.values():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError('Nonfinite source PhysicsManager gravity')
    return dict(result)


def export_motion(source: Path, output: Path):
    import UnityPy
    corpus = json.loads(checked_snapshot(REPO / 'build/corpus')['corpus.json'])
    if hashlib.sha256(canonical(corpus['sources']).encode()).hexdigest() != corpus['sourceSetHash']:
        raise ValueError('Corpus source manifest changed')
    file = 'FINAL FANTASY VI_Data/globalgamemanagers'
    before = digest(source / file)
    env = UnityPy.load(str(source / file))
    managers = [o for o in env.objects if o.type.name == 'PhysicsManager']
    if len(managers) != 1:
        raise ValueError('Missing or ambiguous 3D PhysicsManager source object')
    manager = managers[0]
    if manager.assets_file.unity_version != '2019.4.20f1':
        raise ValueError('Unexpected PhysicsManager Unity version')
    sources = [{'file': file, 'sha256': before}]
    result = {'formatVersion': 1, 'adapterVersion': 'field-particle-motion-0.1.0',
              'parentSourceSetHash': corpus['sourceSetHash'], 'sources': sources,
              'sourceSetHash': hashlib.sha256(canonical(sources).encode()).hexdigest(),
              'physicsManager': {'type': 'PhysicsManager', 'source': {**sources[0],
                  'serializedFile': manager.assets_file.name, 'objectId': str(manager.path_id)},
                  'gravity': gravity_values(manager.read_typetree())}}
    if digest(source / file) != before:
        raise ValueError('PhysicsManager source changed during export')
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / 'physics.json', result)
    write_json(output / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': 'physics.json', 'sha256': digest(output / 'physics.json')}]})
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    result = export_motion(a.source.resolve(), a.output.resolve())
    print(canonical({'sourceSetHash': result['sourceSetHash'], 'physicsManager': result['physicsManager']}))
