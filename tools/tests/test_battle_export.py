from pathlib import Path
import sys
from types import SimpleNamespace as N
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from export_battle import full_rect_picture, character_rows, encounter_rows, sprite_geometry


class EncounterSelectionTests(unittest.TestCase):
    def fixture(self):
        assets = {f'events/{name}.json': {'data': {'Mnemonics': []}}
                  for name in ['sc_e_0002', 'sc_e_0004', 'sc_e_0005', 'sc_e_0006']}
        assets['events/sc_e_0002.json']['data']['Mnemonics'] = [
            {'mnemonic': 'Encount', 'operands': {'iValues': [3], 'sValues': ['continued']}}]
        assets['events/continued.json'] = {'data': {'Mnemonics': []}}
        return {'narshe': {'assets': assets}}, {'monster_party.csv': [{'id': '3'}, {'id': '3002'}, {'id': '3035'}]}

    def test_explicit_selection_keeps_regression_roots_and_source_identity(self):
        project, tables = self.fixture()
        selected = encounter_rows(project, tables, [3035, 3002, 3035])
        self.assertEqual([r['id'] for r in selected], ['3', '3002', '3035'])
        self.assertEqual([r['id'] for r in encounter_rows(project, tables)], ['3'])
        self.assertEqual(len(project['narshe']['assets']['events/sc_e_0002.json']['data']['Mnemonics']), 1)

    def test_invalid_missing_or_ambiguous_selection_never_substitutes_a_party(self):
        for requested in ([0], [-1], [True], [3.0], ['3'], [0x80000000], [404]):
            project, tables = self.fixture()
            with self.assertRaises(ValueError): encounter_rows(project, tables, requested)
        project, tables = self.fixture()
        tables['monster_party.csv'].append({'id': '3002'})
        with self.assertRaises(ValueError): encounter_rows(project, tables, [3002])

    def test_missing_regression_continuation_still_rejects_export(self):
        project, tables = self.fixture()
        del project['narshe']['assets']['events/continued.json']
        with self.assertRaisesRegex(ValueError, 'Missing street script'):
            encounter_rows(project, tables, [3002])


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
        texture = N(m_Width=32, m_Height=32, image=full,
                    m_TextureSettings=N(m_WrapU=1, m_WrapV=1, m_FilterMode=0))
        sprite = N(m_SpriteAtlas=None, m_Rect=N(x=0, y=0, width=32, height=32),
                   m_RD=N(settingsRaw=64, texture=N(deref_parse_as_object=lambda: texture)),
                   image=N(size=(20, 28)), m_PixelsToUnits=1.0)
        return sprite, texture, full

    def test_trimmed_mesh_does_not_shift_the_exported_source_canvas(self):
        sprite, _, full = self.fixture()
        self.assertIs(full_rect_picture(sprite, 'synthetic.png'), full)
        self.assertNotEqual(sprite.image.size, full.size)

    def test_sampling_units_are_preserved_not_replaced_with_renderer_defaults(self):
        sprite, texture, _ = self.fixture()
        sprite.m_PixelsToUnits = 2.5
        texture.m_TextureSettings.m_WrapU = 0
        texture.m_TextureSettings.m_FilterMode = 2
        self.assertEqual(sprite_geometry(sprite, 'synthetic.png'),
                         {'pixelsPerUnit': 2.5, 'textureWrap': [0, 1], 'filterMode': 2})

    def test_unknown_sampling_metadata_is_rejected(self):
        for field, value in [('m_PixelsToUnits', 0), ('m_PixelsToUnits', float('nan')),
                             ('m_WrapV', None), ('m_FilterMode', 4)]:
            sprite, texture, _ = self.fixture()
            target = sprite if field == 'm_PixelsToUnits' else texture.m_TextureSettings
            setattr(target, field, value)
            with self.assertRaises(ValueError): sprite_geometry(sprite, 'synthetic.png')

    def test_atlas_geometry_and_dimension_changes_are_not_silently_flattened(self):
        for change in ('atlas', 'settings', 'offset', 'fraction', 'texture'):
            sprite, texture, _ = self.fixture()
            if change == 'atlas': sprite.m_SpriteAtlas = object()
            if change == 'settings': sprite.m_RD.settingsRaw = 65
            if change == 'offset': sprite.m_Rect.x = 1
            if change == 'fraction': sprite.m_Rect.width = 32.5
            if change == 'texture': texture.image = N(size=(31, 32))
            with self.assertRaises(ValueError): full_rect_picture(sprite, 'synthetic.png')
