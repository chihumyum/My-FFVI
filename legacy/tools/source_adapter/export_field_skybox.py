"""Export the complete source skybox models, full textures and material identity.

Extraction is not shader or runtime admission. In particular a Sprite's packed
render rectangle is not the texture read by the native skybox material.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile

from export_field import checked_snapshot
from import_source import REPO, canonical, digest, normalize_ids, source_ref, write_json


def container_index(env):
    """Keep duplicate path entries with different Unity types, never first-match."""
    entries = {}
    for owner in env.objects:
        if owner.type.name != 'AssetBundle':
            continue
        for path, row in owner.read_typetree()['m_Container']:
            pointer = row['asset']
            if pointer['m_FileID'] != 0:
                raise ValueError('External skybox container object requires explicit resolution')
            obj = owner.assets_file.objects.get(pointer['m_PathID'])
            if obj is None:
                raise ValueError('Missing skybox container object')
            key = (path, obj.type.name)
            if key in entries:
                raise ValueError('Ambiguous skybox container path/type: ' + repr(key))
            entries[key] = obj
    return entries


def source_pair(entries, path, sprite):
    pointer = sprite.m_RD.texture
    if pointer.m_FileID != 0:
        raise ValueError('External skybox Sprite texture requires explicit resolution')
    texture = entries.get((path, 'Texture2D'))
    if texture is None or texture.assets_file is not pointer.assetsfile or texture.path_id != pointer.path_id:
        raise ValueError('Skybox Sprite texture differs from the exact same-path Texture2D')
    return texture


def rect(value):
    return [value.x, value.y, value.width, value.height]


def export_field_skybox(source: Path, out: Path, corpus_root: Path | None = None):
    import UnityPy
    from UnityPy.export.Texture2DConverter import get_image_from_texture2d

    locked = checked_snapshot(corpus_root or REPO / 'build/corpus')
    manifest = json.loads(locked['corpus.json'])
    if hashlib.sha256(canonical(manifest['sources']).encode()).hexdigest() != manifest['sourceSetHash']:
        raise ValueError('Corpus source manifest changed')
    source_rows = {row['file']: row for row in manifest['sources']}
    if len(source_rows) != len(manifest['sources']):
        raise ValueError('Duplicate physical source')
    models = []
    for bundle in manifest['bundles']:
        if not bundle['output']:
            continue
        for asset in json.loads(locked[bundle['output']]):
            if asset['source']['assetPath'] == 'Assets/GameAssets/Serial/Data/Misc/serial_misc_assets.json':
                models.append(asset)
    if len(models) != 1:
        raise ValueError('Missing or ambiguous serial_misc_assets source')
    model_asset = models[0]
    skybox = model_asset['data']['skybox']
    if not isinstance(skybox, dict) or not isinstance(skybox.get('data'), list) or not isinstance(skybox.get('group'), str):
        raise ValueError('Missing source skybox model array/group')
    names = [row['name'] for row in skybox['data']]
    if len(set(names)) != len(names):
        raise ValueError('Ambiguous skybox model name')
    bundles = [row for row in manifest['sources'] if PurePosixPath(row['file']).name.startswith(skybox['group'] + '_assets_all_')]
    if len(bundles) != 1:
        raise ValueError('Missing or ambiguous skybox asset group')
    bundle = bundles[0]
    model_source = source_rows.get(model_asset['source']['file'])
    if model_source is None or model_source['sha256'] != model_asset['source']['sha256']:
        raise ValueError('Model physical source is not bound to the corpus')
    selected = sorted([bundle, model_source], key=lambda row: row['file'])
    for row in selected:
        if digest(source / row['file']) != row['sha256']:
            raise ValueError('Source changed: ' + row['file'])

    env = UnityPy.load(str(source / bundle['file']))
    entries = container_index(env)
    def ref(path, obj):
        return {**source_ref(bundle['file'], path, obj), 'serializedFile': obj.assets_file.name,
                'sha256': bundle['sha256']}

    images = {}
    texture_paths = {path for path, kind in entries if kind == 'Texture2D'}
    sprite_paths = {path for path, kind in entries if kind == 'Sprite'}
    if not texture_paths or texture_paths != sprite_paths:
        raise ValueError('Every skybox Texture2D and Sprite must have an exact source pair')
    for path in sorted(sprite_paths):
        obj = entries[path, 'Sprite']
        sprite = obj.read()
        texture_obj = source_pair(entries, path, sprite)
        texture = texture_obj.read()
        if sprite.m_Name in images:
            raise ValueError('Ambiguous source skybox Sprite name: ' + sprite.m_Name)
        # FactorySkybox reads Sprite.texture. Export its complete decoded pixels;
        # Sprite.image would crop packed fog geometry and lose required pixels.
        image = get_image_from_texture2d(texture, flip=True)
        if image.size != (texture.m_Width, texture.m_Height):
            raise ValueError('Decoded skybox texture dimensions changed')
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        data = buffer.getvalue()
        sha = hashlib.sha256(data).hexdigest()
        target = 'textures/' + sha + '.png'
        (out / 'textures').mkdir(parents=True, exist_ok=True)
        (out / target).write_bytes(data)
        settings = texture.m_TextureSettings
        images[sprite.m_Name] = {
            'source': ref(path, obj), 'spriteSource': ref(path, obj), 'textureSource': ref(path, texture_obj),
            'file': target, 'sha256': sha, 'width': image.width, 'height': image.height,
            'rowOrder': 'top-to-bottom', 'representation': 'source-full-texture',
            'filterMode': settings.m_FilterMode, 'wrap': [settings.m_WrapU, settings.m_WrapV],
            'spriteRect': rect(sprite.m_Rect), 'renderDataRect': rect(sprite.m_RD.textureRect),
            'pixelsPerUnit': sprite.m_PixelsToUnits,
        }
    for row in skybox['data']:
        for name in row['sprites'].values():
            if name not in images:
                raise ValueError('Missing exact skybox model Sprite: ' + name)

    materials = [(path, obj) for (path, kind), obj in entries.items() if kind == 'Material']
    if len(materials) != 1:
        raise ValueError('Missing or ambiguous skybox material')
    path, obj = materials[0]
    material = obj.read_typetree()
    shader = material['m_Shader']
    if shader['m_FileID'] <= 0 or shader['m_FileID'] > len(obj.assets_file.externals):
        raise ValueError('Unrecovered local or invalid skybox shader reference')
    external = obj.assets_file.externals[shader['m_FileID'] - 1]
    shader_reference = {'kind': 'unresolved-external-shader-reference-v1',
                        'fileIndex': shader['m_FileID'], 'objectId': str(shader['m_PathID']),
                        'external': {'path': external.path, 'guid': bytes(external.guid).hex(), 'type': external.type}}
    for row in selected:
        if digest(source / row['file']) != row['sha256']:
            raise ValueError('Source changed during skybox export: ' + row['file'])
    result = {'formatVersion': 1, 'adapterVersion': 'field-skybox-0.1.0',
              'parentSourceSetHash': manifest['sourceSetHash'], 'sources': selected,
              'sourceSetHash': hashlib.sha256(canonical(selected).encode()).hexdigest(),
              'models': {'source': model_asset['source'], **skybox}, 'images': images,
              'material': {'source': ref(path, obj), 'data': normalize_ids(material), 'shaderReference': shader_reference},
              'limitations': ['Full source texture extraction does not admit the Unity shader, fog, effects, 3D projection or runtime callbacks.']}
    write_json(out / 'media.json', result)
    write_json(out / 'snapshot.json', {'formatVersion': 1, 'files': [
        {'file': file.relative_to(out).as_posix(), 'sha256': digest(file)}
        for file in sorted(out.rglob('*')) if file.is_file()]})
    return result


def owned_output_snapshot(target: Path):
    """An existing destination must be this export's complete verified tree.

    A valid directory name is not ownership: never replace corpus, another
    adapter's products, or an export containing unexpected local work.
    """
    if not target.exists():
        return None
    try:
        if any(file.is_symlink() for file in target.rglob('*')):
            raise ValueError('Symlink in existing skybox output')
        media = json.loads((target / 'media.json').read_text())
        if not isinstance(media, dict):
            raise ValueError('Invalid skybox media object')
        checked = checked_snapshot(target)
        if media['formatVersion'] != 1 or media['adapterVersion'] != 'field-skybox-0.1.0':
            raise ValueError('Another adapter owns this output')
        expected = {'media.json'} | {row['file'] for row in media['images'].values()}
        if set(checked) != expected:
            raise ValueError('Unexpected skybox snapshot members')
        for name, row in media['images'].items():
            if (not isinstance(name, str) or not isinstance(row['sha256'], str) or len(row['sha256']) != 64
                    or any(c not in '0123456789abcdef' for c in row['sha256'])
                    or row['file'] != 'textures/' + row['sha256'] + '.png'
                    or hashlib.sha256(checked[row['file']]).hexdigest() != row['sha256']):
                raise ValueError('Unexpected skybox media file identity')
        actual = {file.relative_to(target).as_posix() for file in target.rglob('*') if file.is_file()}
        if actual != expected | {'snapshot.json'}:
            raise ValueError('Untracked files in existing skybox output')
        if {file.relative_to(target).as_posix() for file in target.rglob('*') if file.is_dir()} != {'textures'}:
            raise ValueError('Unexpected directory in existing skybox output')
        return {name: hashlib.sha256(data).hexdigest() for name, data in checked.items()} | {
            'snapshot.json': digest(target / 'snapshot.json')}
    except (KeyError, TypeError, AttributeError, OSError, ValueError) as error:
        raise ValueError('Existing output is not a complete verified skybox media tree') from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=REPO / 'build/field-skybox-media')
    args = parser.parse_args()
    source = args.source.resolve()
    target = args.output.resolve()
    build = (REPO / 'build').resolve()
    if (not target.is_relative_to(build) or target == build or source == target
            or source.is_relative_to(target) or target.is_relative_to(source)):
        raise ValueError('Skybox output must be a separate child of build, outside the source installation')
    previous = owned_output_snapshot(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    staged = Path(tempfile.mkdtemp(prefix='.field-skybox-', dir=target.parent))
    backup = target.parent / ('.previous-' + target.name)
    try:
        result = export_field_skybox(source, staged)
        if backup.exists():
            raise RuntimeError('Inspect interrupted skybox media export first')
        if owned_output_snapshot(target) != previous:
            raise ValueError('Skybox output changed during extraction')
        if target.exists():
            target.rename(backup)
        try:
            staged.rename(target)
        except BaseException:
            if backup.exists():
                backup.rename(target)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        print(canonical({'models': len(result['models']['data']), 'images': len(result['images']),
                         'sourceSetHash': result['sourceSetHash'], 'output': str(target)}))
    finally:
        if staged.exists():
            shutil.rmtree(staged)


if __name__ == '__main__':
    main()
