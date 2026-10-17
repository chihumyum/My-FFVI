"""Read project Shader declarations/pass state directly from the supplied PR bundle."""
import argparse
import json
from pathlib import Path

import UnityPy


def value(item):
    if isinstance(item, dict):
        return {key: value(child) for key, child in item.items()}
    if isinstance(item, (list, tuple)):
        return [value(child) for child in item]
    if isinstance(item, bytes):
        return {"byteLength": len(item)}
    return item


def extract(game, index):
    bundles = sorted(game.rglob("shaders_assets_all_*.bundle"))
    if len(bundles) != 1:
        raise ValueError(f"Expected one PR project shader bundle, found {len(bundles)}")
    source = bundles[0]
    result = []
    for obj in UnityPy.load(str(source)).objects:
        if obj.type.name != "Shader":
            continue
        data = obj.read_typetree()
        parsed = data["m_ParsedForm"]
        properties = []
        for row in parsed["m_PropInfo"]["m_Props"]:
            properties.append({"name": row["m_Name"], "description": row["m_Description"],
                               "type": row["m_Type"], "attributes": row["m_Attributes"],
                               "default": [row[f"m_DefValue[{i}]"] for i in range(4)],
                               "texture": row["m_DefTexture"]})
        passes = []
        for sub in parsed["m_SubShaders"]:
            for row in sub["m_Passes"]:
                state = row.get("m_State", {})
                passes.append({"type": row.get("m_Type"), "name": state.get("m_Name"),
                               "tags": value(row.get("m_Tags")),
                               "state": value({key: child for key, child in state.items()
                                               if not key.startswith("rtBlend") or key == "rtBlend0"})})
        result.append({"name": parsed["m_Name"], "source": {
            "file": source.relative_to(game).as_posix(), "serializedFile": obj.assets_file.name,
            "pathId": str(obj.path_id)}, "properties": properties, "passes": passes,
            "platforms": data["platforms"], "programFormat": "compiled Unity platform 4 / D3D11 DXBC"})
    aliases = {}
    warnings = []
    for row in json.loads(index.read_text())["files"]:
        if not row["counts"].get("Shader"):
            continue
        file = (game / row["file"]).resolve()
        if not file.is_relative_to(game):
            raise ValueError("Shader alias source leaves game directory")
        if file == source:
            continue
        try:
            for obj in UnityPy.load(str(file)).objects:
                if obj.type.name != "Shader":
                    continue
                data = obj.read_typetree()
                name = data.get("m_ParsedForm", {}).get("m_Name") or data.get("m_Name")
                aliases[f"{obj.assets_file.name}:{obj.path_id}"] = name
        except Exception as error:
            warnings.append({"file": row["file"], "reason": f"Shader aliases: {type(error).__name__}: {error}"})
    return {"shaders": result, "aliases": aliases, "warnings": warnings}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(extract(args.game.resolve(), args.index), ensure_ascii=False, separators=(",", ":")))
