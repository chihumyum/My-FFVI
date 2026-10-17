"""Independent PR Unity extraction. Input is only the supplied game directory.

Run: python tools/export/unity.py --game PATH --out EMPTY_OR_PREVIOUS_EXPORT
The output's own cache is reusable; no previous project build is an input.
"""
from __future__ import annotations

import argparse
import base64
from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
import re
import sys
import time

from PIL import Image
import UnityPy
from UnityPy.export.Texture2DConverter import get_image_from_texture2d

from sprites import sprite_image

VERSION = "unity-direct-2"
OBJECT_TYPES = {
    "GameObject", "Transform", "RectTransform", "MonoBehaviour", "MonoScript",
    "Camera", "Canvas", "CanvasRenderer", "SpriteRenderer", "SpriteAtlas",
    "Material", "Animator", "AnimatorController", "Animation", "AnimationClip",
    "Light", "MeshRenderer", "MeshFilter", "SkinnedMeshRenderer", "ParticleSystem",
    "ParticleSystemRenderer", "Font", "AudioSource", "AudioListener", "RenderSettings",
    "PlayerSettings", "QualitySettings", "GraphicsSettings", "PlayableDirector",
}
AUDIO_EXTENSIONS = {".sab", ".mab", ".acb", ".awb", ".bank", ".wem", ".ogg", ".wav", ".mp3", ".flac", ".fsb", ".sac"}


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def normalize(value, key=""):
    if isinstance(value, int) and (key in {"m_PathID", "pathId"} or abs(value) > 9007199254740991):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return {"$unityFloat": str(value)}
    if isinstance(value, dict):
        return {str(k): normalize(v, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize(v) for v in value]
    if isinstance(value, bytes):
        return {"encoding": "base64", "bytes": base64.b64encode(value).decode("ascii")}
    return value


def safe_name(value):
    return re.sub(r"[^\w.\-]", "_", str(value))[:120] or "unnamed"


def media_path(file, name, path_id, extension):
    return f"media/{asset_stem(file)}/{safe_name(name)}-{path_id}{extension}"


def asset_stem(file):
    # globalgamemanagers and globalgamemanagers.assets are separate sources.
    return safe_name(file.stem if file.suffix == ".bundle" else file.name)


def source_ref(file, game, obj, paths):
    return {"file": file.relative_to(game).as_posix(), "assetPath": paths[0] if paths else None,
            "pathId": str(obj.path_id), "serializedFile": obj.assets_file.name,
            **({"assetPaths": paths} if len(paths) > 1 else {})}


def text_bytes(asset):
    value = asset.m_Script
    return value if isinstance(value, bytes) else value.encode("utf-8", "surrogateescape")


def decode_messages(text):
    return dict(line.split("\t", 1) for line in text.splitlines() if "\t" in line)


def export_file(file, game, out):
    env = UnityPy.load(str(file))
    addressed = defaultdict(list)
    for path, obj in env.container.items():
        if obj.path_id:
            reader = obj.deref()
            addressed[(reader.assets_file.name, reader.path_id)].append(path)
    summary = {"file": file.relative_to(game).as_posix(), "tables": {}, "messages": {},
               "media": {"textures": [], "sprites": [], "audio": [], "text": []},
               "outputs": [], "warnings": [], "counts": dict(Counter(obj.type.name for obj in env.objects))}
    assets, objects, external = [], [], {}

    def binary(relative, raw):
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        summary["outputs"].append(relative)

    def png(relative, image):
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", compress_level=3)
        binary(relative, buffer.getvalue())

    for obj in sorted(env.objects, key=lambda o: (o.assets_file.name, o.path_id)):
        kind = obj.type.name
        if kind == "AssetBundle":
            continue
        paths = sorted(addressed[(obj.assets_file.name, obj.path_id)])
        source = source_ref(file, game, obj, paths)
        name = obj.peek_name() or str(obj.path_id)
        ref = {"source": source, "name": name, "type": kind}
        try:
            if kind == "TextAsset":
                raw = text_bytes(obj.read())
                suffix = PurePosixPath(paths[0] if paths else name).suffix.lower()
                # Binary banks are TextAssets in this PR installation.
                if suffix in AUDIO_EXTENSIONS or raw[:4] in {b"sabf", b"mabf", b"FSB5", b"RIFF", b"OggS"}:
                    relative = media_path(file, name, obj.path_id, suffix or ".bin")
                    binary(relative, raw)
                    summary["media"]["audio"].append({**ref, "url": relative, "encoding": "source-bank", "bytes": len(raw)})
                    continue
                try:
                    text = raw.decode("utf-8-sig")
                except UnicodeDecodeError:
                    relative = media_path(file, name, obj.path_id, suffix or ".bin")
                    binary(relative, raw)
                    summary["media"]["text"].append({**ref, "url": relative, "bytes": len(raw), "encoding": "binary"})
                    continue
                if suffix == ".json":
                    assets.append({"source": source, "data": json.loads(text)})
                elif suffix == ".csv":
                    table = PurePosixPath(paths[0] if paths else name).name
                    summary["tables"][table] = list(csv.DictReader(io.StringIO(text)))
                elif suffix == ".txt" and "\t" in text:
                    key = PurePosixPath(paths[0] if paths else name).stem
                    summary["messages"][key] = {"source": source, "values": decode_messages(text)}
                else:
                    relative = media_path(file, name, obj.path_id, suffix or ".txt")
                    binary(relative, raw)
                    summary["media"]["text"].append({**ref, "url": relative, "bytes": len(raw)})
            elif kind == "Texture2D":
                texture = obj.read()
                # Dynamic Unity font atlases have dimensions but no serialized
                # pixels or stream. Their glyphs are generated from the Font;
                # preserve this fact instead of opening an empty stream path.
                stream = getattr(texture, "m_StreamData", None)
                if not texture.image_data and not getattr(stream, "path", ""):
                    summary["media"]["textures"].append({**ref, "url": None,
                        "width": texture.m_Width, "height": texture.m_Height,
                        "runtimeGenerated": True, "imageOrientation": "unity-storage"})
                    continue
                image = get_image_from_texture2d(texture, flip=False)
                relative = media_path(file, name, obj.path_id, ".png")
                displayed = media_path(file, name, obj.path_id, ".display.png")
                png(relative, image)
                png(displayed, image.transpose(Image.Transpose.FLIP_TOP_BOTTOM))
                settings = texture.m_TextureSettings
                summary["media"]["textures"].append({**ref, "url": relative, "displayUrl": displayed,
                    "width": image.width, "height": image.height, "imageOrientation": "unity-storage",
                    "displayOrientation": "top-left", "filterMode": settings.m_FilterMode,
                    "wrapU": settings.m_WrapU, "wrapV": settings.m_WrapV,
                    "format": int(texture.m_TextureFormat)})
            elif kind == "Sprite":
                sprite = obj.read()
                image, metadata = sprite_image(sprite)
                relative = media_path(file, name, obj.path_id, ".png")
                png(relative, image)
                summary["media"]["sprites"].append({**ref, "url": relative, "width": image.width,
                    "height": image.height, **normalize(metadata)})
            elif kind == "AudioClip":
                clip = obj.read()
                exported = []
                for sample, raw in clip.samples.items():
                    relative = media_path(file, sample, obj.path_id, PurePosixPath(sample).suffix or ".audio")
                    binary(relative, raw)
                    exported.append(relative)
                summary["media"]["audio"].append({**ref, "urls": exported, "encoding": "unity-audio-clip",
                    "channels": getattr(clip, "m_Channels", None), "frequency": getattr(clip, "m_Frequency", None)})
            elif kind in OBJECT_TYPES:
                partial = False
                try:
                    tree = obj.read_typetree()
                except ValueError:
                    if kind != "MonoBehaviour":
                        raise
                    # Player native assets may strip the custom type tree.
                    # Keep their standard component header and full raw bytes;
                    # exported bundles with a complete type tree keep all fields.
                    tree = obj.read_typetree(check_read=False)
                    partial = True
                script = None
                if kind == "MonoBehaviour":
                    try:
                        pointer = obj.read(check_read=False).m_Script
                        if pointer:
                            script = pointer.deref_parse_as_object()
                    except (ValueError, FileNotFoundError, KeyError):
                        pass
                metadata = {**ref, "class": getattr(script, "m_ClassName", None),
                    "assembly": getattr(script, "m_AssemblyName", None), "data": normalize(tree)}
                if partial:
                    relative = media_path(file, name, obj.path_id, ".unity.bin")
                    binary(relative, obj.get_raw_data())
                    metadata.update({"partialTypeTree": True, "rawUrl": relative})
                    summary["warnings"].append({"source": source, "name": name, "type": kind,
                        "class": metadata["class"], "error": "Custom MonoBehaviour type tree is stripped; standard fields and source bytes retained", "rawUrl": relative})
                objects.append(metadata)
                sf = obj.assets_file
                external[sf.name] = [{"fileId": i + 1, "path": item.path, "guid": str(item.guid)}
                                     for i, item in enumerate(sf.externals)]
        except Exception as error:
            # Preserve opaque bytes for unsupported metadata/media. Never invent
            # pixels, silently guess canvas offsets or execute source scripts.
            relative = media_path(file, name, obj.path_id, ".unity.bin")
            binary(relative, obj.get_raw_data())
            summary["warnings"].append({"source": source, "name": name, "type": kind,
                "error": f"{type(error).__name__}: {error}", "rawUrl": relative})
    if assets:
        relative = f"raw/bundles/{asset_stem(file)}.json"
        write_json(out / relative, assets)
        summary["outputs"].append(relative)
        summary["bundleOutput"] = relative
    if objects:
        relative = f"raw/objects/{asset_stem(file)}.json"
        write_json(out / relative, {"objects": objects, "externalFiles": external})
        summary["outputs"].append(relative)
        summary["objectsOutput"] = relative
    summary["jsonAssets"] = len(assets)
    summary["metadataObjects"] = len(objects)
    return summary


def source_files(game):
    # Bundles and Unity's native serialized assets are all read from this root.
    files = set(game.rglob("*.bundle")) | set(game.rglob("*.assets"))
    for data in game.glob("*_Data"):
        files.update(path for path in data.glob("level*") if path.is_file() and not path.suffix)
        files.update(path for path in (data / "Resources").glob("*") if path.is_file())
        if (data / "globalgamemanagers").is_file():
            files.add(data / "globalgamemanagers")
    return sorted(files)


def export(game, out, retry_issues=False):
    if game == out or game in out.parents:
        raise ValueError("Output must be separate from the source installation")
    marker = out / ".cache/unity-export.json"
    if out.exists() and any(out.iterdir()) and not marker.exists():
        raise ValueError("Output must be empty or a previous independent Unity export")
    out.mkdir(parents=True, exist_ok=True)
    write_json(marker, {"version": VERSION, "game": str(game)})
    files = source_files(game)
    if not files:
        raise ValueError("No Unity source bundles/assets in --game")
    started, cached = time.monotonic(), 0
    records, warnings = [], []
    tables, messages = {}, {}
    media = {"textures": [], "sprites": [], "audio": [], "text": []}
    for index, file in enumerate(files):
        relative = file.relative_to(game).as_posix()
        source_hash = digest(file)
        # Native serialized assets can store pixels/audio in sibling streams.
        # A changed stream must invalidate its owner's otherwise unchanged cache.
        streams = [] if file.suffix == ".bundle" else sorted(set(
            [*file.parent.glob(file.name + ".resS"), *file.parent.glob(file.name + ".resource"),
             *file.parent.glob(file.stem + ".resS"), *file.parent.glob(file.stem + ".resource")]))
        dependencies = [{"file": path.relative_to(game).as_posix(), "sha256": digest(path)} for path in streams]
        cache = out / ".cache/unity" / (hashlib.sha256(relative.encode()).hexdigest() + ".json")
        previous = json.loads(cache.read_text()) if cache.exists() else None
        output_name_matches = not previous or not previous.get("objectsOutput") or previous["objectsOutput"] == f"raw/objects/{asset_stem(file)}.json"
        if previous and output_name_matches and previous.get("version") == VERSION and previous.get("sha256") == source_hash and previous.get("dependencies", []) == dependencies and not (retry_issues and previous["warnings"]) and all((out / p).is_file() for p in previous["outputs"]):
            record = previous
            cached += 1
        else:
            record = export_file(file, game, out)
            record.update({"version": VERSION, "sha256": source_hash, "bytes": file.stat().st_size, "dependencies": dependencies})
            write_json(cache, record)
        for name, rows in record["tables"].items():
            if name in tables and tables[name] != rows:
                raise ValueError(f"Conflicting source CSV name: {name}")
            tables[name] = rows
        for name, table in record["messages"].items():
            if name in messages and messages[name]["values"] != table["values"]:
                raise ValueError(f"Conflicting source message name: {name}")
            messages[name] = table
        for kind, rows in record["media"].items():
            media[kind].extend(rows)
        warnings.extend(record["warnings"])
        records.append({key: value for key, value in record.items() if key not in {"tables", "messages", "media", "warnings", "outputs", "version"}})
        if (index + 1) % 50 == 0 or index + 1 == len(files):
            print(f"Unity {index+1}/{len(files)} files ({cached} cached), {len(media['sprites'])} sprites, {len(warnings)} issues, {time.monotonic()-started:.1f}s", file=sys.stderr, flush=True)
    write_json(out / "raw/tables.json", tables)
    write_json(out / "raw/messages.json", messages)
    write_json(out / "raw/media.json", media)
    write_json(out / "raw/issues.json", warnings)
    result = {"version": VERSION, "unityPyVersion": UnityPy.__version__, "files": records,
              "counts": {"sourceFiles": len(files), "csvTables": len(tables), "messageTables": len(messages),
                         **{kind: len(rows) for kind, rows in media.items()}, "issues": len(warnings)}}
    write_json(out / "raw/index.json", result)
    return {**result["counts"], "cached": cached, "seconds": round(time.monotonic()-started, 2), "out": str(out)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--retry-issues", action="store_true", help="Re-read cached source files with unsupported objects")
    args = parser.parse_args()
    print(json.dumps(export(args.game.resolve(strict=True), args.out.resolve(), args.retry_issues), ensure_ascii=False))


if __name__ == "__main__":
    main()
