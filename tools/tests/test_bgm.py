import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from export_bgm import platform_name
from audio_export import stream_metadata


class BgmTests(unittest.TestCase):
    def test_exact_platform_name_preserves_language_suffix(self):
        self.assertEqual(platform_name('track_KOR.mab'), 'track_KOR.win.mab.bytes')
        for name in ('../track.mab', '/track.mab', 'track.wav', 'folder\\track.mab'):
            with self.assertRaises(ValueError): platform_name(name)

    def test_sample_loop_validation_never_invents_a_full_file_loop(self):
        m = {'version': 'r2117', 'streamInfo': {'total': 1, 'name': 'source'},
             'sampleRate': 44100, 'numberOfSamples': 88200, 'channels': 2,
             'loopingInfo': None, 'encoding': 'CRI HCA'}
        self.assertIsNone(stream_metadata(m)['loop'])
        m['loopingInfo'] = {'start': 42000, 'end': 88200}
        self.assertEqual(stream_metadata(m)['loop'], m['loopingInfo'])
        for loop in ({'start': 1, 'end': 0}, {'start': 0, 'end': 88201}, {'start': 0.5, 'end': 20}):
            with self.assertRaises(ValueError): stream_metadata({**m, 'loopingInfo': loop})
        with self.assertRaises(ValueError): stream_metadata({**m, 'streamInfo': {'total': 2}})
