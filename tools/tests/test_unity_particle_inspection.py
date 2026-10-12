from pathlib import Path
import struct
import sys
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from inspect_pe import PEImage
from inspect_unity_particles import codeview, icalls, local_symbols, native_body, public_symbols


class UnityParticleInspectionTests(unittest.TestCase):
    def fixture(self):
        data = bytearray(0x1000); data[:2] = b'MZ'
        struct.pack_into('<I', data, 60, 128); data[128:132] = b'PE\0\0'
        struct.pack_into('<HH', data, 132, 0x8664, 2); struct.pack_into('<H', data, 148, 0xf0)
        start = 152; struct.pack_into('<H', data, start, 0x20b)
        struct.pack_into('<Q', data, start + 24, 0x180000000)
        struct.pack_into('<8sIIII', data, start + 0xf0, b'.text\0\0\0', 0x400, 0x1000, 0x400, 0x400)
        struct.pack_into('<8sIIII', data, start + 0xf0 + 40, b'.rdata\0\0', 0x400, 0x2000, 0x400, 0x800)
        struct.pack_into('<II', data, start + 112 + 3*8, 0x2000, 24)
        struct.pack_into('<III', data, 0x800, 0x1000, 0x100a, 0x2020)
        struct.pack_into('<III', data, 0x80c, 0x1010, 0x1016, 0x2028)
        # A function split into two native unwind ranges with one conditional path.
        data[0x400:0x40a] = bytes.fromhex('85c9750cb801000000c3')
        data[0x410:0x416] = bytes.fromhex('b802000000c3')
        struct.pack_into('<II', data, start + 112 + 6*8, 0x2060, 28)
        guid = uuid.UUID('12345678-1234-5678-90ab-cdef12345678')
        cv = b'RSDS' + guid.bytes_le + struct.pack('<I', 2) + b'C:\\build\\Example.pdb\0'
        struct.pack_into('<IIHHIIII', data, 0x860, 0, 0, 0, 0, 2, len(cv), 0x2080, 0x880)
        data[0x880:0x880+len(cv)] = cv
        return data

    def test_codeview_guid_age_build_the_exact_symbol_store_key(self):
        identity = codeview(PEImage(self.fixture()))
        self.assertEqual(identity['guid'], '12345678-1234-5678-90AB-CDEF12345678')
        self.assertEqual(identity['age'], 2)
        self.assertEqual(identity['symbolUrl'], 'https://symbolserver.unity3d.com/Example.pdb/123456781234567890ABCDEF123456782/Example.pdb')

    def test_cfg_range_includes_all_reachable_unwind_fragments(self):
        pe = PEImage(self.fixture())
        symbols = [{'name': 'controlled', 'rva': 0x1000, 'flags': 'function'},
                   {'name': 'next', 'rva': 0x1020, 'flags': 'function'}]
        body = native_body(pe, 0x1000, symbols)
        self.assertEqual(body['size'], 0x16)
        self.assertEqual(len(body['runtimeFunctionRanges']), 2)
        self.assertNotEqual(body['size'], 0xa)

    def test_invalid_symbol_segments_are_not_mapped_to_another_section(self):
        pe = PEImage(self.fixture())
        text = 'S_PUB32 [size = 32] `good`\nflags = function, addr = 0001:0\n' \
               'S_PUB32 [size = 32] `bad`\nflags = function, addr = 0009:0\n'
        self.assertEqual(public_symbols(text, pe), [{'name': 'good', 'rva': 0x1000, 'flags': 'function'}])
        text = 'S_LPROC32 [size = 32] `controlled<0,0>`\nparent = 0, end = 99, addr = 0001:0, code size = 22'
        self.assertEqual(local_symbols(text, pe)[0]['codeSize'], 22)

    def test_icall_binds_both_name_and_actual_function_operand(self):
        data = self.fixture(); at = 0x1020
        code = b'\x48\x8d\x15' + struct.pack('<i', 0x1000-(at+7))
        code += b'\x48\x8d\x0d' + struct.pack('<i', 0x2140-(at+14))
        code += b'\xe8' + struct.pack('<i', 0x1100-(at+19))
        data[0x420:0x420+19] = code
        name = b'UnityEngine.ParticleSystem::Play\0'; data[0x940:0x940+len(name)] = name
        result = icalls(PEImage(data))
        self.assertEqual(len(result), 1); self.assertEqual(result[0]['functionRva'], '0x1000')
        self.assertEqual(result[0]['registrarRva'], '0x1100')
        data[0x427] = 0x90
        self.assertEqual(icalls(PEImage(data)), [])


if __name__ == '__main__': unittest.main()
