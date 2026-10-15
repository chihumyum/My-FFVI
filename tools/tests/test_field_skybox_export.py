from pathlib import Path
from types import SimpleNamespace as S
import hashlib
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_adapter'))
from export_field_skybox import container_index, source_pair
import export_field_skybox as exporter
from import_source import normalize_ids


class SkyboxMediaIdentityTests(unittest.TestCase):
    def fixture(self):
        file = S(name='authored-serialized-file', objects={})
        texture = S(type=S(name='Texture2D'), path_id=9007199254740999, assets_file=file)
        sprite = S(type=S(name='Sprite'), path_id=-9007199254741001, assets_file=file)
        file.objects = {texture.path_id: texture, sprite.path_id: sprite}
        rows = [('Assets/World/sky.png', {'asset': {'m_FileID': 0, 'm_PathID': texture.path_id}}),
                ('Assets/World/sky.png', {'asset': {'m_FileID': 0, 'm_PathID': sprite.path_id}})]
        bundle = S(type=S(name='AssetBundle'), assets_file=file,
                   read_typetree=lambda: {'m_Container': rows})
        return S(objects=[bundle, texture, sprite]), rows, file, texture

    def test_same_path_keeps_sprite_and_texture_with_exact_large_ids(self):
        env, _, file, texture = self.fixture()
        entries = container_index(env)
        self.assertEqual(len(entries), 2)
        pointer = S(m_FileID=0, assetsfile=file, path_id=texture.path_id)
        self.assertIs(source_pair(entries, 'Assets/World/sky.png', S(m_RD=S(texture=pointer))), texture)
        normalized = normalize_ids({'m_PathID': -9007199254741001, 'nested': [{'m_PathID': 9007199254740999}]})
        self.assertEqual(normalized, {'m_PathID': '-9007199254741001', 'nested': [{'m_PathID': '9007199254740999'}]})

    def test_repeated_path_and_type_is_ambiguous_even_if_same_object(self):
        env, rows, _, _ = self.fixture()
        rows.append(rows[0])
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            container_index(env)

    def test_external_or_missing_container_cannot_be_guessed(self):
        for pointer in [{'m_FileID': 1, 'm_PathID': 9007199254740999}, {'m_FileID': 0, 'm_PathID': 3}]:
            env, rows, _, _ = self.fixture()
            rows[0][1]['asset'] = pointer
            with self.subTest(pointer=pointer), self.assertRaises(ValueError):
                container_index(env)

    def test_same_path_and_number_in_another_file_cannot_supply_texture(self):
        env, _, file, texture = self.fixture()
        entries = container_index(env)
        for pointer in [S(m_FileID=0, assetsfile=S(name=file.name), path_id=texture.path_id),
                        S(m_FileID=0, assetsfile=file, path_id=texture.path_id + 1),
                        S(m_FileID=1, assetsfile=file, path_id=texture.path_id)]:
            with self.subTest(pointer=pointer), self.assertRaises(ValueError):
                source_pair(entries, 'Assets/World/sky.png', S(m_RD=S(texture=pointer)))


class SkyboxOutputOwnershipTests(unittest.TestCase):
    def write_owned(self, path):
        path.mkdir(parents=True, exist_ok=True)
        pixels = b'authored extraction bytes'
        sha = hashlib.sha256(pixels).hexdigest()
        (path / 'textures').mkdir()
        file = 'textures/' + sha + '.png'
        (path / file).write_bytes(pixels)
        media = {'formatVersion': 1, 'adapterVersion': 'field-skybox-0.1.0',
                 'images': {'authored': {'file': file, 'sha256': sha}}}
        (path / 'media.json').write_text(json.dumps(media))
        snapshot = {'formatVersion': 1, 'files': [
            {'file': name, 'sha256': hashlib.sha256((path / name).read_bytes()).hexdigest()}
            for name in ['media.json', file]]}
        (path / 'snapshot.json').write_text(json.dumps(snapshot))
        return file

    def test_existing_unrelated_build_input_and_its_sentinel_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'build/corpus'
            target.mkdir(parents=True)
            sentinel = target / 'source-input.json'
            sentinel.write_bytes(b'authored unrelated input')
            with self.assertRaisesRegex(ValueError, 'Existing output'):
                exporter.owned_output_snapshot(target)
            self.assertEqual(sentinel.read_bytes(), b'authored unrelated input')

    def test_complete_own_snapshot_has_a_stable_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'owned'
            self.write_owned(target)
            receipt = exporter.owned_output_snapshot(target)
            self.assertEqual(receipt, exporter.owned_output_snapshot(target))
            self.assertEqual(len(receipt), 3)
            self.assertIsNone(exporter.owned_output_snapshot(Path(tmp) / 'absent'))

    def test_unlisted_file_or_empty_directory_cannot_be_removed_by_reexport(self):
        for directory in [False, True]:
            with tempfile.TemporaryDirectory() as tmp:
                target = Path(tmp) / 'owned'
                self.write_owned(target)
                extra = target / 'unrelated'
                extra.mkdir() if directory else extra.write_bytes(b'keep')
                with self.assertRaisesRegex(ValueError, 'Existing output'):
                    exporter.owned_output_snapshot(target)
                self.assertTrue(extra.exists())

    def test_modified_pixel_bytes_and_other_adapter_are_not_accepted_as_owned(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'owned'
            file = self.write_owned(target)
            (target / file).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'Existing output'):
                exporter.owned_output_snapshot(target)
            (target / 'media.json').write_text(json.dumps({'formatVersion': 1, 'adapterVersion': 'another'}))
            with self.assertRaisesRegex(ValueError, 'Existing output'):
                exporter.owned_output_snapshot(target)

    def test_link_to_other_files_is_not_followed_as_owned_media(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'owned'
            file = self.write_owned(target)
            outside = Path(tmp) / 'outside'
            outside.write_bytes(b'keep')
            (target / file).unlink()
            (target / file).symlink_to(outside)
            with self.assertRaisesRegex(ValueError, 'Existing output'):
                exporter.owned_output_snapshot(target)
            self.assertEqual(outside.read_bytes(), b'keep')

    def test_cli_rejects_changed_destination_after_extracting_without_replacing_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'build/runtime/game'
            source.mkdir(parents=True)
            target = root / 'build/field-skybox-media'
            self.write_owned(target)
            original = (target / 'media.json').read_bytes()
            def extract(_source, staged):
                self.write_owned(staged)
                (target / 'concurrent-user-work').write_bytes(b'keep')
                return {}
            with patch.object(exporter, 'REPO', root), patch.object(exporter, 'export_field_skybox', extract), \
                    patch.object(sys, 'argv', ['export', '--source', str(source), '--output', str(target)]):
                with self.assertRaisesRegex(ValueError, 'Existing output'):
                    exporter.main()
            self.assertEqual((target / 'media.json').read_bytes(), original)
            self.assertEqual((target / 'concurrent-user-work').read_bytes(), b'keep')
            self.assertFalse((target.parent / '.previous-field-skybox-media').exists())


if __name__ == '__main__':
    unittest.main()
