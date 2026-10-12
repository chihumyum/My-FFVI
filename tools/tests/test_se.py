import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from export_se import decode_sound_bank, sound_rows
from sab import environment_program
from test_environment_audio import bank


def row(identity='101'):
    return {'id': identity, 'asset_name': 'ordinary.sab', 'se_name': 'fixture_se', 'resident': '0'}


class SoundMediaTests(unittest.TestCase):
    def test_master_identity_is_sorted_detached_and_keeps_resident_policy_as_data(self):
        raw = [row('102'), {**row(), 'resident': '1'}]
        result = sound_rows(raw)
        self.assertEqual([r['id'] for r in result], ['101', '102'])
        self.assertEqual(result[0]['resident'], '1')
        result[0]['asset_name'] = 'changed.sab'
        self.assertEqual(raw[1]['asset_name'], 'ordinary.sab')

    def test_ambiguous_unknown_and_unsafe_rows_are_never_best_effort(self):
        invalid = [row('0'), row('-1'), row('01'), row('2147483648'), row('１２'),
                   {**row(), 'resident': '2'}, {**row(), 'gain': '1'},
                   {**row(), 'asset_name': '../ordinary.sab'},
                   {**row(), 'asset_name': 'ordinary.akb'},
                   {**row(), 'se_name': '../fixture_se'}]
        for value in invalid:
            with self.subTest(row=value), self.assertRaises(ValueError):
                sound_rows([value])
        with self.assertRaises(ValueError):
            sound_rows([row(), row()])

    def test_single_program_gain_and_loop_are_preserved_without_mutating_program(self):
        raw = bytes(bank(loop=True, ramp=True))
        program = environment_program(raw)
        before = copy.deepcopy(program)
        decoded = {'sampleRate': 44100, 'frames': 5000, 'channels': 1,
                   'loop': {'start': 42, 'end': 4900}, 'sha256': 'a' * 64}
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            with patch('export_se.decode_stream', return_value=decoded) as decode:
                result = decode_sound_bank(raw, program, temp / 'source.sab', temp, temp)
                decode.assert_called_once_with(temp / 'source.sab', temp, temp)
            self.assertEqual((temp / 'source.sab').read_bytes(), raw)
        self.assertEqual(program, before)
        self.assertEqual(result['gain'], .5)
        self.assertEqual(result['gainRamp'], {'from': 0, 'to': 1, 'durationMs': 600})
        self.assertEqual(result['loop'], decoded['loop'])
        self.assertNotIn('looping', result)

    def test_decoder_loop_mismatch_is_an_export_failure_not_an_omitted_entry(self):
        raw = bytes(bank(loop=False, ramp=False))
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            with patch('export_se.decode_stream', return_value={'loop': {'start': 0, 'end': 40}}):
                with self.assertRaisesRegex(ValueError, 'loop disagree'):
                    decode_sound_bank(raw, environment_program(raw), temp / 'source.sab', temp, temp)

    def test_decoder_and_pcm_errors_propagate_for_atomic_staging(self):
        raw = bytes(bank(loop=False, ramp=False))
        for message in ['Unreviewed decoder or multi-stream audio', 'Audio PCM round trip changed']:
            with tempfile.TemporaryDirectory() as directory:
                temp = Path(directory)
                with patch('export_se.decode_stream', side_effect=ValueError(message)):
                    with self.assertRaisesRegex(ValueError, message):
                        decode_sound_bank(raw, environment_program(raw), temp / 'source.sab', temp, temp)


if __name__ == '__main__':
    unittest.main()
