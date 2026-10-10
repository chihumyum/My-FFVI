"""Read source-addressed PE bytes for static analysis; never load or execute the DLL."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import struct


class PEImage:
    def __init__(self, data: bytes):
        self.data = data
        if len(data) < 64 or data[:2] != b'MZ': raise ValueError('Not a PE image')
        pe = struct.unpack_from('<I', data, 60)[0]
        if pe + 24 > len(data) or data[pe:pe+4] != b'PE\0\0': raise ValueError('Invalid PE header')
        machine, count = struct.unpack_from('<HH', data, pe+4)
        optional = struct.unpack_from('<H', data, pe+20)[0]
        start = pe + 24
        if machine != 0x8664 or optional < 112 or start+optional+count*40 > len(data):
            raise ValueError('Expected a complete x64 PE header')
        if struct.unpack_from('<H', data, start)[0] != 0x20b: raise ValueError('Expected PE32+')
        self.image_base = struct.unpack_from('<Q', data, start+24)[0]
        self.sections = []
        for index in range(count):
            name, virtual_size, rva, raw_size, offset = struct.unpack_from('<8sIIII', data, start+optional+index*40)
            if offset + raw_size > len(data): raise ValueError('Section exceeds file')
            self.sections.append((name.rstrip(b'\0').decode('ascii'), rva, virtual_size, raw_size, offset))

    def read(self, rva: int, size: int):
        if rva < 0 or size < 1: raise ValueError('Invalid RVA/size')
        found = [s for s in self.sections if s[1] <= rva and rva+size <= s[1]+min(s[2], s[3])]
        if len(found) != 1: raise ValueError('RVA range is not uniquely backed by source bytes')
        name, address, _, _, raw = found[0]
        offset = raw + rva - address
        return name, offset, self.data[offset:offset+size]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    parser.add_argument('--rva', type=lambda s: int(s, 0), action='append', required=True)
    parser.add_argument('--size', type=int, default=4)
    args = parser.parse_args()
    data = args.file.read_bytes(); pe = PEImage(data); values = []
    for rva in args.rva:
        section, offset, raw = pe.read(rva, args.size)
        item = {'rva': hex(rva), 'va': hex(pe.image_base+rva), 'section': section,
                'fileOffset': hex(offset), 'hex': raw.hex(), 'sha256': hashlib.sha256(raw).hexdigest()}
        if args.size == 4:
            item.update(int32=struct.unpack('<i', raw)[0], float32=struct.unpack('<f', raw)[0])
        values.append(item)
    print(json.dumps({'file': args.file.name, 'sha256': hashlib.sha256(data).hexdigest(), 'values': values},
                     indent=2, allow_nan=False))


if __name__ == '__main__': main()
