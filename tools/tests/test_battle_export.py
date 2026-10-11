from pathlib import Path
import sys
from types import SimpleNamespace as N
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from export_battle import full_rect_picture, character_rows


class CharacterMediaTests(unittest.TestCase):
    def fixture(self):
        return {'initialize_data.csv': [{'key_name': 'INIT_PARTY_1', 'value1': '4'}],
                'character_status.csv': [{'id': '2'}, {'id': '4'}, {'id': '7'}]}

    def test_media_expansion_preserves_initial_party_and_stable_source_identity(self):
        tables = self.fixture()
        rows = character_rows(tables, [7, 2, 7])
        self.assertEqual([r['id'] for r in rows], ['2', '4', '7'])
        self.assertEqual(tables['initialize_data.csv'], [{'key_name': 'INIT_PARTY_1', 'value1': '4'}])
        self.assertEqual([r['id'] for r in character_rows(tables)], ['4'])

    def test_missing_duplicate_or_noninteger_id_cannot_select_another_character(self):
        for request in ([3], [0], [-1], [True], [2.0], ['2']):
            with self.assertRaises(ValueError): character_rows(self.fixture(), request)
        tables = self.fixture()
        tables['character_status.csv'].append({'id': '4'})
        with self.assertRaises(ValueError): character_rows(tables)


class BattleSpriteTests(unittest.TestCase):
    def fixture(self):
        full = N(size=(32, 32))
        texture = N(m_Width=32, m_Height=32, image=full)
        sprite = N(m_SpriteAtlas=None, m_Rect=N(x=0, y=0, width=32, height=32),
                   m_RD=N(settingsRaw=64, texture=N(deref_parse_as_object=lambda: texture)),
                   image=N(size=(20, 28)))
        return sprite, texture, full

    def test_trimmed_mesh_does_not_shift_the_exported_source_canvas(self):
        sprite, _, full = self.fixture()
        self.assertIs(full_rect_picture(sprite, 'synthetic.png'), full)
        self.assertNotEqual(sprite.image.size, full.size)

    def test_atlas_geometry_and_dimension_changes_are_not_silently_flattened(self):
        for change in ('atlas', 'settings', 'offset', 'fraction', 'texture'):
            sprite, texture, _ = self.fixture()
            if change == 'atlas': sprite.m_SpriteAtlas = object()
            if change == 'settings': sprite.m_RD.settingsRaw = 65
            if change == 'offset': sprite.m_Rect.x = 1
            if change == 'fraction': sprite.m_Rect.width = 32.5
            if change == 'texture': texture.image = N(size=(31, 32))
            with self.assertRaises(ValueError): full_rect_picture(sprite, 'synthetic.png')
