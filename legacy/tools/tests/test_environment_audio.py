import struct
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from sab import environment_program
from export_environment import bank_path


def bank(loop=True, ramp=True):
    """Authored single-program SAB fixture; contains no game audio or source data."""
    data = bytearray(576)
    data[:4] = b'sabf'
    data[4], data[8] = 2, 4
    struct.pack_into('<I', data, 12, len(data))
    for i, (name, at) in enumerate(zip([b'snd ', b'seq ', b'trk ', b'mtrl'], [96, 224, 320, 512])):
        entry = 32 + i * 16
        data[entry:entry + 4] = name
        struct.pack_into('<I', data, entry + 8, at)
        struct.pack_into('<H', data, at + 4, 1)
        struct.pack_into('<I', data, at + 16, 32)
    data[128], data[132], data[133] = 17, 1, 1
    struct.pack_into('<H', data, 130, 96)
    struct.pack_into('<f', data, 140, 0.5)
    struct.pack_into('<H', data, 154, 48)
    struct.pack_into('<H', data, 178, 16)
    data[256] = 4
    struct.pack_into('<HH', data, 258, 32, 0)
    struct.pack_into('<H', data, 262, 32)
    data[288:292] = bytes([2, 4, 2, 12])
    data[296] = int(loop)
    data[304:308] = bytes([0, 4, 1, 0])
    data[352:356] = bytes([2, 1, 16, 0])
    struct.pack_into('<H', data, 366, 16)
    commands = [(3, 0 if ramp else 0.5, 0)]
    if ramp: commands.append((3, 1, 600))
    commands.append((4, 1, 0))
    cursor = 368
    for kind, value, duration in commands:
        data[cursor:cursor + 4] = bytes([1, 4, kind, 12])
        struct.pack_into('<fI', data, cursor + 4, value, duration)
        cursor += 16
    data[cursor:cursor + 4] = bytes([0, 4, 1, 0])
    return data


class EnvironmentAudioTests(unittest.TestCase):
    def test_gain_program_preserves_source_loop_and_multiplies_static_levels(self):
        program = environment_program(bank())
        self.assertEqual(program['gain'], 0.5)
        self.assertEqual(program['gainRamp'], {'from': 0, 'to': 1, 'durationMs': 600})
        self.assertTrue(program['looping'])
        one_shot = environment_program(bank(loop=False, ramp=False))
        self.assertFalse(one_shot['looping'])
        self.assertEqual(one_shot['gain'], 0.25)
        self.assertIsNone(one_shot['gainRamp'])

    def test_complex_bank_or_unreviewed_mixer_cannot_be_silently_flattened(self):
        for change in ('multiple', 'pitch', 'curve', 'continuation', 'nonfinite', 'truncated'):
            with self.subTest(change=change):
                data = bank()
                if change == 'multiple': struct.pack_into('<H', data, 100, 2)
                if change == 'pitch': struct.pack_into('<f', data, 404, 0.5)
                if change == 'curve': data[396] = 1
                if change == 'continuation': data[306] = 2
                if change == 'nonfinite': struct.pack_into('<f', data, 140, float('nan'))
                if change == 'truncated': data = data[:-1]
                with self.assertRaises(ValueError): environment_program(data)

    def test_environment_path_uses_exact_source_bank_not_bgm_platform_suffix(self):
        self.assertEqual(bank_path({'se_name': 'ff6_se', 'asset_name': 'sound.sab'}),
                         'Assets/GameAssets/Common/Res/Audio/ff6_se/sound.sab.bytes')
        for group, name in [('../group', 'sound.sab'), ('ff6_se', '../sound.sab'),
                            ('ff6_se', r'folder\sound.sab'), ('ff6_se', 'sound.mab')]:
            with self.assertRaises(ValueError): bank_path({'se_name': group, 'asset_name': name})


if __name__ == '__main__': unittest.main()
