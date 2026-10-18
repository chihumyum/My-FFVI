"""Visual review aids only. Heuristics flag candidates; they never certify a scene."""
import json
import math
import os
import sys
import hashlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(sys.argv[1])
review_root = Path(os.environ.get("PLAY_REVIEW_DIR", root))
output = review_root / "walls"
output.mkdir(exist_ok=True, parents=True)
frame_range = [int(value) for value in os.environ.get("PLAY_FRAME_RANGE", "1:999999").split(":")]
excluded_kinds = os.environ.get("PLAY_EXCLUDE_KINDS", "").split(",")
data_root = Path(os.environ.get("PLAY_DATA_DIR", "build/web-data"))
presentation = json.loads((data_root / "presentation.json").read_text())
font_info = next(row for row in presentation["fonts"] if row.get("primary"))
font_path = data_root / font_info["url"].removeprefix("/web-data/")
font = ImageFont.truetype(str(font_path), 14)
entries = []
images = {}
for file in sorted(root.glob("[0-9]*.json")):
    row = json.loads(file.read_text())
    if not row.get("completed") or not frame_range[0] <= row["sequence"] <= frame_range[1] or row["kind"] in excluded_kinds:
        continue
    image = Image.open(root / row["screenshot"]).convert("RGB")
    row["pixelDigest"] = hashlib.sha256(str(image.size).encode() + image.tobytes()).hexdigest()
    small = image.resize((160, 90))
    colors = list(small.getdata())
    dark = sum(max(rgb) < 24 for rgb in colors) / len(colors)
    flat = max(small.getcolors(160 * 90) or [(0, None)])[0] / len(colors)
    fade = row.get("fade")
    alpha = 0
    if fade:
        t = max(0, min(1, (row["time"] - fade["start"]) / (fade.get("duration") or 0.000001)))
        alpha = fade["from"] + (fade["to"] - fade["from"]) * t
    reasons = []
    if dark > .9:
        reasons.append("mostly-dark")
    if flat > .85:
        reasons.append("mostly-one-color")
    if row.get("pixelIssues"):
        reasons.append("transparent-selected-actor-texture")
    if row.get("errors"):
        reasons.append("browser-script-error")
    if row.get("metrics", {}).get("texturesFailed"):
        reasons.append("texture-load-failed")
    row["pixelScreen"] = {"darkFraction": dark, "flatFraction": flat, "fadeAlpha": alpha}
    row["reviewCandidates"] = reasons
    row["confidence"] = "high" if any(r not in ["mostly-dark", "mostly-one-color"] for r in reasons) else "low" if alpha > .9 else "medium"
    entries.append(row)

groups = {}
stable_walls = os.environ.get("PLAY_STABLE_WALLS") == "1"
deduplicate = os.environ.get("PLAY_DEDUPLICATE") == "1"
prior_path = os.environ.get("PLAY_REVIEWED_DIGESTS")
prior = {row["pixelDigest"]: row for row in json.loads(Path(prior_path).read_text())} if prior_path else {}
review_entries = []
for row in entries:
    canonical = images.setdefault(row["pixelDigest"], row["sequence"])
    row["reviewSequence"] = canonical if deduplicate else row["sequence"]
    row["priorReview"] = prior.get(row["pixelDigest"])
    if (not deduplicate or canonical == row["sequence"]) and not row["priorReview"]:
        review_entries.append(row)
for ordinal, row in enumerate(review_entries):
    cell = row["sequence"] - 1 if stable_walls else ordinal
    groups.setdefault(cell // 16, []).append((cell % 16, row))
for wall, cells in groups.items():
    sheet = Image.new("RGB", (1600, 1040), (19, 23, 32))
    draw = ImageDraw.Draw(sheet)
    for n, row in cells:
        x, y = (n % 4) * 400, (n // 4) * 260
        im = Image.open(root / row["screenshot"]).convert("RGB")
        im.thumbnail((392, 221))
        sheet.paste(im, (x + 4, y))
        label = f'{row["sequence"]:05} {row["kind"]} {row.get("map", row["mapId"])}'
        second = f'{row.get("script") or ""} B:{row.get("encounterId") or "-"}'
        draw.text((x + 5, y + 223), label[:47], font=font, fill="white")
        draw.text((x + 5, y + 241), second[:47], font=font, fill="#aabbd0")
        if row["reviewCandidates"]:
            draw.rectangle((x, y, x + 399, y + 259), outline="#ecad43", width=2)
    sheet.save(output / f'{wall + 1:03}.jpg', quality=92)

report = {"scope": "Heuristic pending list only, not confirmed defects; every contact-sheet cell still requires visual review. Fade metadata explains some black frames but does not suppress them.", "stableSequenceWalls": stable_walls, "screenshots": len(entries), "walls": len(groups), "candidates": [{k: row.get(k) for k in ["sequence", "kind", "mapId", "map", "script", "encounterId", "screenshot", "reviewCandidates", "confidence", "pixelScreen", "pixelIssues"]} for row in sorted(entries, key=lambda row: ({"high": 0, "medium": 1, "low": 2}[row["confidence"]], row["sequence"])) if row["reviewCandidates"]]}
report["uniqueImages"] = len(review_entries)
report["previouslyReviewed"] = sum(bool(row["priorReview"]) for row in entries)
report["priorReviewRegistry"] = prior_path
report["exactPixelDeduplication"] = deduplicate
report["reviewMap"] = [{k: row.get(k) for k in ["sequence", "reviewSequence", "pixelDigest", "kind", "mapId", "script", "screenshot", "priorReview"]} for row in entries]
(review_root / "pending-visual-review.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps({"screenshots": report["screenshots"], "walls": report["walls"], "candidates": len(report["candidates"])}))
