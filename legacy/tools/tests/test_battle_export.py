from pathlib import Path
from copy import deepcopy
import sys
from types import SimpleNamespace as N
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from export_battle import full_rect_picture, character_rows, encounter_rows, sprite_geometry, battle_media_rows


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


class BattleMediaSelectionTests(unittest.TestCase):
    def fixture(self):
        parties = [dict(id='700', battle_background_asset_id='8',
                        **{f'monster{i}': '0' for i in range(1, 10)})]
        parties[0]['monster2'] = '31'
        parties[0]['monster8'] = '31'
        return {'monster.csv': [{'id': '97'}, {'id': '4'}, {'id': '31'}],
                'battle_background_asset.csv': [{'id': '9'}, {'id': '8'}]}, parties

    def test_all_media_covers_nonparty_masters_without_broadening_the_encounter(self):
        tables, parties = self.fixture()
        before = deepcopy((tables, parties))
        monsters, backgrounds, selection = battle_media_rows(tables, parties, True, True)
        self.assertEqual([r['id'] for r in monsters], ['4', '31', '97'])
        self.assertEqual([r['id'] for r in backgrounds], ['8', '9'])
        self.assertEqual(selection, {'kind': 'media-selection-v1',
            'monsters': {'mode': 'all', 'masterIds': [4, 31, 97]},
            'backgrounds': {'mode': 'all', 'masterIds': [8, 9]}})
        self.assertEqual((tables, parties), before)
        self.assertEqual([party['id'] for party in parties], ['700'])

    def test_modes_are_independent_and_default_does_not_add_a_declaration(self):
        tables, parties = self.fixture()
        monsters, backgrounds, selection = battle_media_rows(tables, parties)
        self.assertEqual([r['id'] for r in monsters], ['31'])
        self.assertEqual([r['id'] for r in backgrounds], ['8'])
        self.assertIsNone(selection)
        for all_monsters, all_backgrounds in [(True, False), (False, True)]:
            _, _, selected = battle_media_rows(tables, parties, all_monsters, all_backgrounds)
            self.assertEqual(selected['monsters'], {'mode': 'all', 'masterIds': [4, 31, 97]}
                             if all_monsters else {'mode': 'encounters', 'masterIds': [31]})
            self.assertEqual(selected['backgrounds'], {'mode': 'all', 'masterIds': [8, 9]}
                             if all_backgrounds else {'mode': 'encounters', 'masterIds': [8]})

    def test_all_scope_rejects_duplicate_and_invalid_even_unreferenced_master_rows(self):
        for value in ['0', '-1', '04', '2147483648', 'not-an-id', 4, True]:
            tables, parties = self.fixture()
            tables['monster.csv'][0]['id'] = value
            with self.assertRaisesRegex(ValueError, 'Invalid media source identity'):
                battle_media_rows(tables, parties, True, False)
        for table in ['monster.csv', 'battle_background_asset.csv']:
            tables, parties = self.fixture()
            tables[table].append(dict(tables[table][0]))
            with self.assertRaisesRegex(ValueError, 'Duplicate media source identity'):
                battle_media_rows(tables, parties, True, True)

    def test_expansion_cannot_hide_a_missing_selected_party_reference(self):
        for field in ['monster8', 'battle_background_asset_id']:
            tables, parties = self.fixture()
            parties[0][field] = '999'
            with self.assertRaisesRegex(ValueError, 'Unresolved'):
                battle_media_rows(tables, parties, True, True)
        tables, parties = self.fixture()
        for all_monsters, all_backgrounds in [(1, False), (True, 'all'), (None, False)]:
            with self.assertRaisesRegex(ValueError, 'Invalid battle media selection mode'):
                battle_media_rows(tables, parties, all_monsters, all_backgrounds)


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
