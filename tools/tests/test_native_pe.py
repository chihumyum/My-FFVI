from pathlib import Path
import struct
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from inspect_pe import PEImage


class PESourceTests(unittest.TestCase):
    def fixture(self):
        data = bytearray(1024); data[:2] = b'MZ'
        struct.pack_into('<I', data, 60, 128); data[128:132] = b'PE\0\0'
        struct.pack_into('<HH', data, 132, 0x8664, 1)
        struct.pack_into('<H', data, 148, 112)
        struct.pack_into('<H', data, 152, 0x20b)
        struct.pack_into('<Q', data, 176, 0x180000000)
        struct.pack_into('<8sIIII', data, 264, b'.rdata\0\0', 512, 0x3000, 256, 512)
        struct.pack_into('<f', data, 528, 30)
        return data

    def test_rva_uses_section_mapping_and_rejects_virtual_only_bytes(self):
        pe = PEImage(self.fixture())
        self.assertEqual(pe.read(0x3010, 4), ('.rdata', 528, b'\0\0\xf0A'))
        for rva, size in [(0x3100, 4), (0x30ff, 2), (0x1000, 4), (0x3010, 0)]:
            with self.assertRaises(ValueError): pe.read(rva, size)

    def test_truncation_is_not_mistaken_for_zero_filled_source(self):
        with self.assertRaises(ValueError): PEImage(self.fixture()[:600])
        with self.assertRaises(ValueError): PEImage(b'not PE')
