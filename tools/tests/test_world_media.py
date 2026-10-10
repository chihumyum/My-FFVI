from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from export_world_media import package_path


class WorldMediaIdentityTests(unittest.TestCase):
    def test_media_resolves_within_its_package(self):
        self.assertEqual(package_path('Assets/Map/Area/package.json', 'Tiles/Atlas', '.png'),
                         'Assets/Map/Area/Tiles/Atlas.png')
        self.assertNotEqual(package_path('Assets/Map/Other/package.json', 'Tiles/Atlas', '.png'),
                            package_path('Assets/Map/Area/package.json', 'Tiles/Atlas', '.png'))

    def test_unsafe_media_paths_cannot_escape_the_package(self):
        for name in ['', '../Atlas', 'Tiles/../../Atlas', '/Atlas', 'Tiles\\Atlas']:
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    package_path('Assets/Map/Area/package.json', name, '.png')
