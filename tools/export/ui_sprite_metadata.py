"""Read the requested UI Sprite borders from their original Unity bundles."""
import argparse
import json
from pathlib import Path
import sys

import UnityPy


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--game", required=True, type=Path)
args = parser.parse_args()
requests = json.load(sys.stdin)
groups = {}
for request in requests:
    groups.setdefault(request["file"], []).append(request)
result = {}
for relative, rows in groups.items():
    game = args.game.resolve()
    file = (game / relative).resolve()
    if not file.is_relative_to(game):
        raise ValueError("UI source bundle leaves the game directory")
    wanted = {(row["serializedFile"], row["pathId"]): row["key"] for row in rows}
    env = UnityPy.load(str(file))
    for obj in env.objects:
        key = wanted.get((obj.assets_file.name, str(obj.path_id)))
        if key is None or obj.type.name != "Sprite":
            continue
        border = obj.read().m_Border
        result[key] = {"left": border.x, "top": border.w, "right": border.z, "bottom": border.y}
print(json.dumps(result))
