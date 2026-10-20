"""Package individually generated art; crop, nearest-neighbor export and atlas packing only."""

import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "build/play/deployment/akto-art-test"
RAW = OUT / "raw"
ASSETS = OUT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)
manifest = {"tileSize": 16, "modules": {}, "guard": {}, "notes": []}


def open_image(name):
    return Image.open(RAW / f"{name}.png").convert("RGBA")


def bounds(im):
    return im.getchannel("A").point(lambda v: 255 if v > 96 else 0).getbbox()


def module(name, size, crop=None, contain=False):
    im = open_image(name)
    rect = crop or bounds(im)
    part = im.crop(rect)
    if contain:
        ratio = min(size[0] / part.width, size[1] / part.height)
        resized = part.resize((round(part.width * ratio), round(part.height * ratio)), Image.Resampling.NEAREST)
        result = Image.new("RGBA", size)
        result.alpha_composite(resized, ((size[0] - resized.width) // 2, size[1] - resized.height))
    else:
        result = part.resize(size, Image.Resampling.NEAREST)
    result.save(ASSETS / f"{name}.png")
    manifest["modules"][name] = {"file": f"assets/{name}.png", "width": size[0], "height": size[1], "sourceSize": list(im.size), "crop": list(rect)}
    return result


# The AI sheet is retained as a discarded concept, never used for the map.
wall = open_image("wall")
module("wall", (64, 96), (360, 160, 695, 770))
module("gate", (192, 192), contain=True)
module("tower", (112, 176), contain=True)
module("bridge", (160, 96))
module("bank", (128, 32), (0, 235, 1983, 608))
module("ground", (64, 64))
module("water", (64, 64))
module("icon", (48, 48), contain=True)
module("factory", (80, 96), contain=True)
# Reuse the generated bridge's road surface for the sealed city's paving.
paving = Image.open(ASSETS / "bridge.png").convert("RGBA").crop((30, 0, 130, 96)).resize((64, 64), Image.Resampling.NEAREST)
paving.save(ASSETS / "paving.png")
manifest["modules"]["paving"] = {"file": "assets/paving.png", "width": 64, "height": 64, "derivedFrom": "bridge", "crop": [30, 0, 130, 96]}

sheet = open_image("guard")
alpha = sheet.getchannel("A")
active_rows = []
for y in range(sheet.height):
    count = sum(value > 96 for value in alpha.crop((0, y, sheet.width, y + 1)).get_flattened_data())
    if count > 12:
        active_rows.append(y)
bands = []
for y in active_rows:
    if not bands or y - bands[-1][-1] > 12:
        bands.append([y])
    else:
        bands[-1].append(y)
if len(bands) != 4:
    raise ValueError(f"Expected four separate guard direction bands; found {len(bands)}")
frames = []
for row, direction in enumerate(["down", "up", "left", "right"]):
    for column in range(3):
        # The model did not respect equal row heights. Content bands avoid
        # clipping the next direction's plume into the preceding frame.
        cell = sheet.crop((round(column * sheet.width / 3), max(0, bands[row][0] - 2), round((column + 1) * sheet.width / 3), min(sheet.height, bands[row][-1] + 3)))
        rect = bounds(cell)
        if not rect:
            raise ValueError(f"Empty guard frame {direction}:{column}")
        frames.append((direction, column, cell, rect))
scale = 28 / max(rect[3] - rect[1] for _, _, _, rect in frames)
packed = Image.new("RGBA", (96, 128))
for index, (direction, column, cell, rect) in enumerate(frames):
    part = cell.crop(rect)
    part = part.resize((max(1, round(part.width * scale)), max(1, round(part.height * scale))), Image.Resampling.NEAREST)
    part = part.crop(bounds(part))
    canvas = Image.new("RGBA", (32, 32))
    canvas.alpha_composite(part, ((32 - part.width) // 2, 30 - part.height))
    canvas.save(ASSETS / f"guard-{direction}-{column}.png")
    packed.alpha_composite(canvas, (column * 32, index // 3 * 32))
    manifest["guard"][f"{direction}-{column}"] = {"width": 32, "height": 32, "contentBounds": list(bounds(canvas)), "sourceBounds": list(rect), "file": f"assets/guard-{direction}-{column}.png"}
    if bounds(canvas)[3] != 30:
        raise ValueError(f"Guard foot baseline drift: {direction}:{column}")
packed.save(ASSETS / "guard-sheet.png")
manifest["notes"] = [
    "Nine environment/icon modules were generated separately; paving is a crop of the generated bridge road. The first multi-object draft is excluded.",
    "Only cropping, common-scale nearest-neighbor conversion and transparent-canvas atlas packing are applied; no hand-painted replacement art.",
    "Guard frames use observed alpha-content row bands, a common content scale and foot baseline of 30 within a 32px canvas. Equal row slicing was rejected because the model's rows drifted.",
    "Repeat modules are mirrored at alternate placements by standard tile flip bits; same edge samples meet at the join.",
    "Exact image-model canvas sizes and uniform logical-pixel blocks were not obeyed by the raw generations; these PNGs are runtime exports, not claims of native PR pixel artistry.",
]
(OUT / "asset-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(json.dumps({"modules": len(manifest["modules"]), "guardFrames": len(frames), "output": str(ASSETS)}))
