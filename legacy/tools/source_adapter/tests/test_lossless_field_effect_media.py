from pathlib import Path
import importlib.util
import json
import math
import struct
import unittest

TOOLS = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('lossless_field_effect_media', TOOLS / 'export_field_effect_media.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LosslessEffectScalarTests(unittest.TestCase):
    def test_nonfinite_values_keep_decoded_bits_and_classification(self):
        for value, kind in [(math.inf, 'positive-infinity'), (-math.inf, 'negative-infinity'), (math.nan, 'nan')]:
            result = module.preserve_ids(value)
            self.assertEqual(result[module.NONFINITE_TAG]['kind'], kind)
            self.assertEqual(result[module.NONFINITE_TAG]['bits'], struct.pack('<d', value).hex())
            json.dumps(result, allow_nan=False)

    def test_ids_and_negative_zero_are_not_rounded_or_normalized(self):
        result = module.preserve_ids({'m_PathID': -9223372036854775807, 'values': [0.0, -0.0, 2**-40]})
        self.assertEqual(result['m_PathID'], '-9223372036854775807')
        self.assertEqual(struct.pack('<d', result['values'][1]).hex(), '0000000000000080')

    def test_reserved_source_keys_cannot_impersonate_typed_scalar(self):
        for key in [module.NONFINITE_TAG, '$unityBytes']:
            with self.assertRaisesRegex(ValueError, 'collides'):
                module.preserve_ids({key: 'original source object'})

    def test_bytes_retain_payload_not_only_a_digest(self):
        original = bytes([0, 255, 17])
        encoded = module.preserve_ids(original)
        self.assertEqual(encoded['$unityBytes']['encoding'], 'hex')
        self.assertEqual(bytes.fromhex(encoded['$unityBytes']['bytes']), original)


if __name__ == '__main__':
    unittest.main()
