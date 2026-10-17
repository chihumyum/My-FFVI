import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source_adapter"))
from import_source import normalize_ids, asset_path, canonical


class AdapterTests(unittest.TestCase):
    def test_unity_identity_never_rounds(self):
        n = -9127841932506724402
        value = normalize_ids({"nested": [{"m_PathID": n, "m_FileID": 2}]})
        self.assertEqual(value["nested"][0]["m_PathID"], str(n))
        self.assertEqual(value["nested"][0]["m_FileID"], 2)

    def test_source_path_traversal_rejected(self):
        for s in ["Assets/../escape", "/Assets/x", "Assets\\x", "other/x"]:
            with self.assertRaises(ValueError): asset_path(s)

    def test_canonical_order_and_nonfinite_values(self):
        self.assertEqual(canonical({"a": 1, "b": 2}), canonical({"b": 2, "a": 1}))
        with self.assertRaises(ValueError): canonical({"x": float("nan")})

    def test_timeline_infinite_extrapolation_is_preserved(self):
        self.assertEqual(normalize_ids({"m_PostExtrapolationTime": float("inf")}),
                         {"m_PostExtrapolationTime": {"$unityFloat": "Infinity"}})


if __name__ == "__main__": unittest.main()
