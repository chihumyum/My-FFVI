"""Read-only Unity adapter. Generated output is local, deterministic, and non-executable."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import shutil
import tempfile
from collections import Counter
from pathlib import Path, PurePosixPath

ADAPTER_VERSION = "0.1.1"
REPO = Path(__file__).resolve().parents[2]


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def normalize_ids(value, key=""):
    # Path IDs exceed JS's 53-bit integer range; keep signed decimal identities.
    if key == "m_PathID" and isinstance(value, int):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return {"$unityFloat": "NaN" if math.isnan(value) else "Infinity" if value > 0 else "-Infinity"}
    if isinstance(value, dict):
        return {k: normalize_ids(v, k) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize_ids(v) for v in value]
    if isinstance(value, bytes):
        return {"byteLength": len(value), "sha256": hashlib.sha256(value).hexdigest()}
    return value


def asset_path(value):
    p = PurePosixPath(value)
    if p.is_absolute() or ".." in p.parts or "\\" in value or not value.startswith("Assets/"):
        raise ValueError(f"Unsafe source asset path: {value}")
    return value


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(canonical(value) + "\n", encoding="utf-8")


def source_ref(bundle, path, obj=None):
    r = {"file": bundle, "assetPath": asset_path(path)}
    if obj is not None:
        r["objectId"] = str(obj.path_id)
    return r


def tables_from(env):
    result = {}
    for path, obj in sorted(env.container.items(), key=lambda item: (item[0], str(item[1].path_id))):
        if obj.type.name == "TextAsset" and path.endswith(".csv"):
            name = PurePosixPath(path).name
            if name in result:
                raise ValueError(f"Duplicate table: {name}")
            result[name] = list(csv.DictReader(io.StringIO(obj.read().m_Script)))
    return result


def timeline_graph(env):
    scripts = {}
    # Identity is scoped to serialized file; never join different files by path ID alone.
    for obj in env.objects:
        if obj.type.name == "MonoScript":
            scripts[(obj.assets_file.name, str(obj.path_id))] = obj.read_typetree()
    objects = []
    keep = {"Camera", "PlayableDirector", "Transform", "GameObject", "Light"}
    for obj in sorted(env.objects, key=lambda o: (o.assets_file.name, o.path_id)):
        if obj.type.name not in keep | {"MonoBehaviour"}:
            continue
        data = obj.read_typetree()
        script = None
        if obj.type.name == "MonoBehaviour":
            ref = data.get("m_Script", {})
            script = scripts.get((obj.assets_file.name, str(ref.get("m_PathID")))) if ref.get("m_FileID") == 0 else None
            # Keep custom components too: their unsupported behavior must stay visible.
        objects.append({
            "file": obj.assets_file.name,
            "id": str(obj.path_id),
            "type": obj.type.name,
            "class": None if script is None else script.get("m_ClassName"),
            "assembly": None if script is None else script.get("m_AssemblyName"),
            "data": normalize_ids(data),
        })
    serialized = {}
    for obj in env.objects:
        f = obj.assets_file
        if f.name not in serialized:
            serialized[f.name] = [
                {"fileId": i + 1, "path": x.path, "guid": str(x.guid)}
                for i, x in enumerate(f.externals)
            ]
    return {"objects": objects, "externalFiles": serialized}


def import_source(source: Path, out: Path):
    import UnityPy
    from UnityPy.export.Texture2DConverter import get_image_from_texture2d

    data = source / "FINAL FANTASY VI_Data"
    bundles = data / "StreamingAssets/aa/StandaloneWindows64"
    if not bundles.is_dir():
        raise ValueError("Expected the extracted FINAL FANTASY VI game directory")

    def one(pattern):
        found = sorted(bundles.glob(pattern))
        if len(found) != 1:
            raise ValueError(f"Expected one {pattern}, got {len(found)}")
        return found[0]

    master_file = one("master_assets_all_*.bundle")
    messages_file = one("message_assets_all_*.bundle")
    map_file = one("map_20010_assets_all_*.bundle")
    opera_files = sorted(bundles.glob("ff6_opera_*_assets_all_*.bundle"))
    corpus_files = sorted(f for f in bundles.glob("*.bundle") if f.name.startswith(("map_", "battle_script_", "common_battle_script_")))
    selected = sorted(set(corpus_files + opera_files + [master_file, messages_file]))
    locked = selected + [source / "GameAssembly.dll", data / "il2cpp_data/Metadata/global-metadata.dat", data / "StreamingAssets/aa/catalog.json"]
    sources = [{"file": str(f.relative_to(source)), "sha256": digest(f), "bytes": f.stat().st_size} for f in sorted(locked)]
    source_set = hashlib.sha256(canonical(sources).encode()).hexdigest()
    tables = tables_from(UnityPy.load(str(master_file)))
    messages = {}
    for path, obj in sorted(UnityPy.load(str(messages_file)).container.items(), key=lambda item: (item[0], str(item[1].path_id))):
        if PurePosixPath(path).name in {"system_en.txt", "system_zhc.txt"}:
            messages[PurePosixPath(path).stem] = dict(line.split("\t", 1) for line in obj.read().m_Script.splitlines() if "\t" in line)
    regions = []
    for rid, name_key in [("narshe", "MSG_MAP_NAME_09"), ("opera", "MSG_MAP_NAME_43")]:
        areas = [a for a in tables["area.csv"] if a["area_name"] == name_key]
        if len(areas) != 1:
            raise ValueError(f"Ambiguous area binding for {rid}")
        area = areas[0]
        regions.append({"id": rid, "areaId": area["id"], "nameKey": name_key,
            "names": {lang: values[name_key] for lang, values in messages.items()},
            "maps": [r for r in tables["map.csv"] if r["area_id"] == area["id"]],
            "worldPhase": "unknown", "evidence": [
                {"file": master_file.name, "table": "area.csv", "row": area["id"]},
                {"file": master_file.name, "table": "map.csv", "filter": {"area_id": area["id"]}},
                {"file": messages_file.name, "messageKey": name_key},
            ]})
    out.mkdir(parents=True, exist_ok=True)
    textures = []
    map_assets = {}
    map_env = UnityPy.load(str(map_file))
    for path, obj in sorted(map_env.container.items(), key=lambda item: (item[0], str(item[1].path_id))):
        asset_path(path)
        if obj.type.name == "TextAsset" and path.endswith(".json"):
            map_assets[path] = {"source": source_ref(map_file.name, path, obj), "data": json.loads(obj.read().m_Script)}
        if obj.type.name == "Texture2D":
            d = obj.read()
            (out / "textures").mkdir(exist_ok=True)
            # This map's Tiled atlas uses storage row order. UnityPy's convenience
            # image getter flips it, changing every tile address as well as its pixels.
            png = io.BytesIO()
            get_image_from_texture2d(d, flip=False).save(png, format="PNG")
            png_bytes = png.getvalue()
            texture_hash = hashlib.sha256(png_bytes).hexdigest()
            file = "textures/" + texture_hash + ".png"
            (out / file).write_bytes(png_bytes)
            textures.append({"source": source_ref(map_file.name, path, obj), "name": d.m_Name, "file": file,
                "width": d.m_Width, "height": d.m_Height, "sha256": digest(out / file), "rowOrder": "unity-storage"})
    opera = []
    for f in opera_files:
        env = UnityPy.load(str(f))
        graph = timeline_graph(env)
        filename = "opera/" + f.stem + ".json"
        write_json(out / filename, graph)
        opera.append({"sourceFile": f.name, "graphFile": filename,
            "objectTypes": dict(sorted(Counter(o.type.name for o in env.objects).items())),
            "timelineClasses": dict(sorted(Counter(o["class"] for o in graph["objects"] if o["assembly"] == "Unity.Timeline.dll").items())),
            "unverified": ["active-root", "external-references", "timeline-semantics", "materials", "audio-clock", "original-comparison"]})
    corpus = {"bundleCount": len(corpus_files), "jsonCount": 0, "mnemonicScriptCount": 0, "opcodes": {}, "syscalls": {}}
    opcodes = Counter(); syscalls = Counter()
    for f in corpus_files:
        env = UnityPy.load(str(f))
        for path, obj in sorted(env.container.items(), key=lambda item: (item[0], str(item[1].path_id))):
            if obj.type.name != "TextAsset" or not path.endswith(".json"):
                continue
            raw = json.loads(obj.read().m_Script)
            corpus["jsonCount"] += 1
            if isinstance(raw, dict) and isinstance(raw.get("Mnemonics"), list):
                corpus["mnemonicScriptCount"] += 1
                for m in raw["Mnemonics"]:
                    opcodes[m["mnemonic"]] += 1
                    if m["mnemonic"] == "SysCall":
                        # The selector is retained, but its parameter/behavior semantics remain unverified.
                        syscalls[canonical(m.get("operands", {}))] += 1
    corpus["opcodes"] = dict(sorted(opcodes.items())); corpus["syscalls"] = dict(sorted(syscalls.items()))
    for item, f in zip(sources, sorted(locked)):
        if item["sha256"] != digest(f):
            raise ValueError(f"Source changed during import: {f.name}")
    result = {"formatVersion": 1, "adapterVersion": ADAPTER_VERSION, "unityPyVersion": UnityPy.__version__,
        "sourceSetHash": source_set, "sources": sources, "regions": regions,
        "narshe": {"mapName": "Map_20010", "assets": map_assets, "textures": textures},
        "opera": opera, "corpus": corpus}
    write_json(out / "project.json", result)
    write_json(out / "tables.json", tables)
    write_json(out / "snapshot.json", {"formatVersion": 1, "files": [
        {"file": p.relative_to(out).as_posix(), "sha256": digest(p)}
        for p in sorted(out.rglob("*")) if p.is_file()
    ]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    build = REPO / "build"; build.mkdir(exist_ok=True)
    staged = Path(tempfile.mkdtemp(prefix=".import-", dir=build))
    try:
        result = import_source(args.source.resolve(), staged)
        target = build / "import"; backup = build / ".previous-import"
        if backup.exists():
            raise RuntimeError("Previous interrupted import exists; inspect build/.previous-import before continuing")
        if target.exists():
            target.rename(backup)
        try:
            staged.rename(target)
        except BaseException:
            if backup.exists(): backup.rename(target)
            raise
        if backup.exists(): shutil.rmtree(backup)
        print(canonical({"sourceSetHash": result["sourceSetHash"], "regions": [{"id": r["id"], "maps": len(r["maps"])} for r in result["regions"]],
            "corpus": {k: v for k, v in result["corpus"].items() if k not in {"opcodes", "syscalls"}}, "output": str(target)}))
    finally:
        if staged.exists(): shutil.rmtree(staged)


if __name__ == "__main__":
    main()
