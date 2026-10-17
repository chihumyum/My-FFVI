"""Fetch pinned public reference files into an ignored research directory.

They are evidence for public mode arithmetic and enum identities, not a license
to redistribute Unity implementation source or proof of its private C++ kernel.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

COMMIT = 'a4fc5011a29781c15e3ee181f19d80dc7fbab19f'
FILES = {
    'ParticleSystemStructs.cs': '4c06d5620eeb48cce65314975d61a0012d827cd3d7e91e0d78ebaf9e67197534',
    'ParticleSystemEnums.cs': '5526e19e82cbfe32acbf8a765f114a211d40baa9f4f9c1a1e5158d8730073062',
}


def fetch(output: Path):
    records = []
    for name, expected in FILES.items():
        url = f'https://raw.githubusercontent.com/Unity-Technologies/UnityCsReference/{COMMIT}/Modules/ParticleSystem/Managed/{name}'
        with urlopen(url, timeout=30) as response:
            body = response.read()
        actual = hashlib.sha256(body).hexdigest()
        if actual != expected:
            raise ValueError(f'Pinned Unity reference changed: {name}')
        output.mkdir(parents=True, exist_ok=True)
        (output / name).write_bytes(body)
        records.append({'file': name, 'url': url, 'sha256': actual})
    receipt = {'formatVersion': 1, 'unityVersion': '2019.4.20f1', 'commit': COMMIT, 'files': records,
               'semanticsVerified': False, 'license': 'Unity Reference-Only License; research files remain ignored'}
    (output / 'snapshot.json').write_text(json.dumps(receipt, sort_keys=True, indent=2) + '\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    result = fetch(parser.parse_args().output.resolve())
    print(json.dumps({'status': 'pass', 'files': len(result['files']), 'commit': COMMIT}))
