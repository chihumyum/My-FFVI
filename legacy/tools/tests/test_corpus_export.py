import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from export_corpus import classify_json


class CorpusExportTests(unittest.TestCase):
    def test_script_identity_requires_instruction_array(self):
        self.assertEqual(classify_json({'Mnemonics': []}), 'script')
        self.assertEqual(classify_json({'Mnemonics': 'invalid'}), 'data')
        self.assertEqual(classify_json([]), 'data')
        self.assertEqual(classify_json({'map': [], 'asset_group_name': 'fixture'}), 'map-package')
