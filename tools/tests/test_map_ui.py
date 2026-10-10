from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from export_map_ui import local_reference


class MapUiIdentityTests(unittest.TestCase):
    def test_reference_scope_and_int64_identity_are_preserved(self):
        obj = SimpleNamespace(type=SimpleNamespace(name='Sprite'))
        owner = SimpleNamespace(assets_file=SimpleNamespace(objects={9007199254740993: obj}))
        pointer = {'m_FileID': 0, 'm_PathID': '9007199254740993'}
        self.assertIs(local_reference(owner, pointer, 'Sprite'), obj)
        for invalid in [dict(pointer, m_FileID=1), dict(pointer, m_PathID='9007199254740992')]:
            with self.assertRaises(ValueError): local_reference(owner, invalid, 'Sprite')
        with self.assertRaises(ValueError): local_reference(owner, pointer, 'Texture2D')
