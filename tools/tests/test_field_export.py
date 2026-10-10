import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from export_field import checked_snapshot


class FieldSnapshotTests(unittest.TestCase):
    def test_snapshot_rejects_mutation_and_aliases(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'entry.json').write_text('{}')
            item = {'file': 'entry.json', 'sha256': hashlib.sha256(b'{}').hexdigest()}
            def write(items):
                (root / 'snapshot.json').write_text(json.dumps({'files': items}))
            write([item])
            self.assertEqual(checked_snapshot(root)['entry.json'], b'{}')
            write([item, item])
            with self.assertRaises(ValueError): checked_snapshot(root)
            for name in ['../entry.json', '/entry.json', 'dir\\entry.json']:
                write([{**item, 'file': name}])
                with self.assertRaises(ValueError): checked_snapshot(root)
            write([item])
            (root / 'entry.json').write_text('{"changed":true}')
            with self.assertRaises(ValueError): checked_snapshot(root)
