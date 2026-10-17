"""Decode only PR opera/default/effect meshes with UnityPy's mesh reader.

No scene geometry is manufactured here. Scene transforms and materials are
resolved separately from the already extracted original object records.
"""
import argparse
import hashlib
import json
from pathlib import Path

import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler


def file_hash(file):
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def export_meshes(game, out):
    index = json.loads((out / "raw/index.json").read_text())
    meshes, render_textures, shaders, warnings = {}, {}, {}, []
    sources = [row for row in index["files"] if "ff6_opera_" in row["file"] or
               row.get("counts", {}).get("Mesh") and
               ("effects_meshes_" in row["file"] or row["file"].endswith("unity default resources"))]
    folder = out / "opera"
    output = folder / "meshes.json"
    cache_file = out / ".cache" / "opera-meshes.json"
    inputs = {row["file"]: file_hash(game / row["file"]) for row in sources}
    signature = {"inputs": inputs, "exporter": file_hash(Path(__file__)),
                 "unityPy": getattr(UnityPy, "__version__", "")}
    try:
        cached = json.loads(cache_file.read_text())
        if cached["signature"] == signature and cached["output"] == file_hash(output):
            data = json.loads(output.read_text())
            print(json.dumps({"operaMeshes": len(data["meshes"]), "cached": True,
                              "warnings": data["warnings"]}))
            return
    except (OSError, ValueError, KeyError):
        pass
    for row in sources:
        env = UnityPy.load(str(game / row["file"]))
        for obj in env.objects:
            key = f"{obj.assets_file.name}:{obj.path_id}"
            if obj.type.name == "Shader":
                try:
                    parsed = obj.read_typetree()["m_ParsedForm"]
                    sub = parsed.get("m_SubShaders", [{}])[0]
                    tags = dict(sub.get("m_Tags", {}).get("tags", []))
                    state = sub.get("m_Passes", [{}])[0].get("m_State", {})
                    shaders[key] = {"name": parsed.get("m_Name", ""),
                                    "queue": tags.get("QUEUE"),
                                    "renderType": tags.get("RenderType"),
                                    "zTest": state.get("zTest"),
                                    "zWrite": state.get("zWrite")}
                except Exception as error:
                    warnings.append(f"Shader state {key}: {type(error).__name__}: {error}")
                continue
            if obj.type.name == "RenderTexture":
                value = obj.read_typetree()
                render_textures[key] = {"name": value["m_Name"], "width": value["m_Width"],
                                        "height": value["m_Height"], "filter": value["m_TextureSettings"]["m_FilterMode"]}
            if obj.type.name != "Mesh":
                continue
            try:
                mesh = obj.read()
                handler = MeshHandler(mesh)
                handler.process()
                triangles = handler.get_triangles()
                vertices = [list(v[:3]) for v in handler.m_Vertices]
                uv = [list(v[:2]) for v in (handler.m_UV0 or [])]
                value = {"name": mesh.m_Name, "vertices": vertices, "uv": uv,
                         "submeshes": [[i for triangle in part for i in triangle] for part in triangles]}
                if handler.m_BoneWeights and handler.m_BoneIndices:
                    value["weights"] = [list(v) for v in handler.m_BoneWeights]
                    value["boneIndices"] = [list(v) for v in handler.m_BoneIndices]
                    value["bindPoses"] = [[getattr(p, f"e{r}{c}") for c in range(4) for r in range(4)]
                                          for p in (mesh.m_BindPose or [])]
                meshes[key] = value
            except Exception as error:
                warnings.append(f"Mesh {key}: {type(error).__name__}: {error}")
    folder.mkdir(exist_ok=True)
    output.write_text(json.dumps({"meshes": meshes, "renderTextures": render_textures,
                                                   "shaders": shaders,
                                                   "warnings": warnings}, separators=(",", ":")))
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps({"signature": signature, "output": file_hash(output)}))
    print(json.dumps({"operaMeshes": len(meshes), "warnings": warnings}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    export_meshes(args.game, args.out)
