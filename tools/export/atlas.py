#!/usr/bin/env python3
"""Pack only runtime PNG references; source URL keys and RGBA canvases stay intact."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sys
import time
from urllib.parse import unquote, urlsplit

from PIL import Image, __version__ as PILLOW_VERSION


EXTRUDE = 1
SPACING = 1
PADDING = EXTRUDE + SPACING


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    temporary.replace(path)


def read_json(path: Path, fallback: object = None):
    return json.loads(path.read_text()) if path.exists() else fallback


def scan_references(root: Path) -> dict[str, set[str]]:
    references: dict[str, set[str]] = {}

    def add(value, purpose):
        if isinstance(value, str) and value.startswith("/web-data/") and urlsplit(value).path.lower().endswith(".png"):
            references.setdefault(value, set()).add(purpose)

    def walk(value, purpose):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ("file", "url"):
                    add(child, purpose)
                if key == "textures" and isinstance(child, dict):
                    for image in child.values():
                        add(image, "tileset")
                walk(child, purpose)
        elif isinstance(value, list):
            for child in value:
                walk(child, purpose)

    inputs = [root / "data.json", root / "battle.json", *sorted((root / "maps").glob("*.json"))]
    if not (root / "maps").is_dir():
        raise ValueError(f"Map directory is missing: {root / 'maps'}")
    for path in inputs:
        if not path.is_file():
            raise ValueError(f"Runtime JSON is missing: {path}")
        walk(read_json(path), "data" if path.name == "data.json" else "battle" if path.name == "battle.json" else "map")
    return references


def source_path(root: Path, url: str) -> Path:
    relative = unquote(urlsplit(url).path[len("/web-data/"):])
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"PNG reference leaves the data directory: {url}")
    if not path.is_file():
        raise ValueError(f"Referenced source PNG is missing: {url} ({path})")
    return path


def asset_group(url: str, purposes: set[str]) -> str:
    bundle = url.split("/")[3] if len(url.split("/")) > 3 else "shared"
    # Field/battle character poses share one small, demand-loaded source-bundle group.
    if bundle.startswith(("mo_", "bc_")):
        return "character/" + bundle
    if "tileset" in purposes:
        return "tilesets"
    if bundle.startswith("mn_"):
        return "monsters"
    if bundle.startswith("bg_"):
        return "battle-backgrounds"
    # Keep large event/UI collections together, without mixing every unrelated scene.
    return "shared/" + bundle


def pack_group(images: list[dict], page_limit: int) -> list[dict]:
    """Stable best-fit shelves, no rotations or logical-canvas trimming."""
    ordered = sorted(images, key=lambda image: (-image["height"], -image["width"], image["hash"]))
    widest = max(image["width"] + PADDING * 2 for image in ordered)
    tallest = max(image["height"] + PADDING * 2 for image in ordered)
    limit = max(page_limit, widest, tallest)
    if limit > 4096:
        raise ValueError(f"Image including extrusion exceeds 4096 pixels: {widest}x{tallest}")
    area = sum((image["width"] + PADDING * 2) * (image["height"] + PADDING * 2) for image in ordered)
    width = min(limit, max(widest, math.ceil(math.sqrt(min(area, limit * limit)))))
    pages = []
    for image in ordered:
        w = image["width"] + PADDING * 2
        h = image["height"] + PADDING * 2
        candidates = []
        for pi, page in enumerate(pages):
            for si, shelf in enumerate(page["shelves"]):
                if shelf["height"] >= h and shelf["x"] + w <= width:
                    candidates.append((shelf["height"] - h, width - shelf["x"] - w, pi, si))
        if candidates:
            _, _, pi, si = min(candidates)
            page = pages[pi]
            shelf = page["shelves"][si]
        else:
            page = next((p for p in pages if p["height"] + h <= limit), None)
            if page is None:
                page = {"shelves": [], "height": 0, "width": 0, "images": []}
                pages.append(page)
            shelf = {"x": 0, "y": page["height"], "height": h}
            page["shelves"].append(shelf)
            page["height"] += h
        frame = {"x": shelf["x"] + PADDING, "y": shelf["y"] + PADDING, "w": image["width"], "h": image["height"]}
        page["images"].append((image, frame))
        shelf["x"] += w
        page["width"] = max(page["width"], shelf["x"])
    return pages


def paste_extruded(page: Image.Image, image: Image.Image, frame: dict) -> None:
    x, y, w, h = (frame[key] for key in ("x", "y", "w", "h"))
    page.paste(image, (x, y))
    page.paste(image.crop((0, 0, w, 1)), (x, y - 1))
    page.paste(image.crop((0, h - 1, w, h)), (x, y + h))
    page.paste(image.crop((0, 0, 1, h)), (x - 1, y))
    page.paste(image.crop((w - 1, 0, w, h)), (x + w, y))
    for sx, sy, dx, dy in [(0, 0, x - 1, y - 1), (w - 1, 0, x + w, y - 1), (0, h - 1, x - 1, y + h), (w - 1, h - 1, x + w, y + h)]:
        page.putpixel((dx, dy), image.getpixel((sx, sy)))


def export(root: Path, output: Path, page_limit: int, verify: bool) -> dict:
    started = time.monotonic()
    output.mkdir(parents=True, exist_ok=True)
    atlases = output / "atlases"
    atlases.mkdir(exist_ok=True)
    profile = {"tool": digest(Path(__file__).read_bytes()), "pillow": PILLOW_VERSION, "pageLimit": page_limit, "extrude": EXTRUDE, "spacing": SPACING, "pngCompression": 9}
    cache_path = output / ".cache" / "atlas.json"
    previous = read_json(cache_path, {})
    cache = previous if previous.get("profile") == profile else {}
    old_groups = cache.get("groups", {})
    references = scan_references(root)
    canonical = {}
    by_url = {}
    source_bytes = 0
    for url, purposes in sorted(references.items()):
        path = source_path(root, url)
        content = path.read_bytes()
        fingerprint = digest(content)
        source_bytes += len(content)
        image = canonical.get(fingerprint)
        if image is None:
            with Image.open(io.BytesIO(content)) as original:
                image = {"hash": fingerprint, "width": original.width, "height": original.height, "path": path, "group": asset_group(url, purposes), "urls": []}
            canonical[fingerprint] = image
        image["urls"].append(url)
        by_url[url] = fingerprint
    groups = {}
    for image in canonical.values():
        groups.setdefault(image["group"], []).append(image)
    next_groups = {}
    frames = {}
    pages_metadata = {}
    reused_groups = 0
    generated_pages = 0
    for number, (group, images) in enumerate(sorted(groups.items()), 1):
        signature = digest(json.dumps(sorted(image["hash"] for image in images)).encode())
        cached = old_groups.get(group, {})
        good_cache = cached.get("signature") == signature and all(
            (output / page["file"]).is_file() and (output / page["file"]).stat().st_size == page["bytes"]
            for page in cached.get("pages", [])
        ) and bool(cached.get("pages"))
        if good_cache:
            entry = cached
            reused_groups += 1
        else:
            entry = {"signature": signature, "frames": {}, "pages": []}
            for packed in pack_group(images, page_limit):
                page = Image.new("RGBA", (packed["width"], packed["height"]), (0, 0, 0, 0))
                for image, frame in packed["images"]:
                    with Image.open(image["path"]) as original:
                        rgba = original.convert("RGBA")
                        paste_extruded(page, rgba, frame)
                        rgba.close()
                buffer = io.BytesIO()
                page.save(buffer, format="PNG", compress_level=9)
                content = buffer.getvalue()
                page.close()
                file = f"atlases/{digest(content)}.png"
                path = output / file
                if not path.exists():
                    temporary = path.with_suffix(".png.tmp")
                    temporary.write_bytes(content)
                    temporary.replace(path)
                entry["pages"].append({"file": file, "width": packed["width"], "height": packed["height"], "bytes": len(content), "images": len(packed["images"])})
                for image, frame in packed["images"]:
                    entry["frames"][image["hash"]] = {"file": file, "frame": frame}
                generated_pages += 1
            if number % 100 == 0 or len(images) > 100:
                print(f"atlas group {number}/{len(groups)}: {group}, {len(images)} images", file=sys.stderr, flush=True)
        next_groups[group] = entry
        frames.update(entry["frames"])
        for page in entry["pages"]:
            pages_metadata[page["file"]] = page
    index = {url: frames[fingerprint] for url, fingerprint in by_url.items()}
    summary = {
        "sourceBytes": source_bytes,
        "uniqueSourceBytes": sum(image["path"].stat().st_size for image in canonical.values()),
        "atlasBytes": sum(page["bytes"] for page in pages_metadata.values()),
        "images": len(index),
        "uniqueImages": len(canonical),
        "deduplicatedImages": len(index) - len(canonical),
        "pages": len(pages_metadata),
        "groups": len(groups),
        "pageLimit": page_limit,
        "largestPage": max((max(page["width"], page["height"]) for page in pages_metadata.values()), default=0),
        "extrude": EXTRUDE,
        "spacing": SPACING,
        "cacheGroupsReused": reused_groups,
        "pagesGenerated": generated_pages,
    }
    if verify:
        summary["validation"] = validate(root, output, index)
    # Only remove pages the previous invocation owned. Never touch another build's files.
    previous_pages = {page["file"] for entry in previous.get("groups", {}).values() for page in entry.get("pages", [])}
    for file in previous_pages - pages_metadata.keys():
        path = (output / file).resolve()
        if path.is_relative_to(atlases.resolve()) and path.is_file():
            path.unlink()
    summary["elapsedSeconds"] = round(time.monotonic() - started, 3)
    write_json(output / "atlas-index.json", {"images": index, "summary": summary})
    write_json(cache_path, {"profile": profile, "groups": next_groups})
    return summary


def validate(root: Path, output: Path, index: dict) -> dict:
    """Compare every referenced image's complete RGBA rectangle, including hidden RGB."""
    by_page = {}
    for url, entry in index.items():
        by_page.setdefault(entry["file"], []).append((url, entry["frame"]))
    checked = 0
    for file, entries in sorted(by_page.items()):
        with Image.open(output / file) as encoded:
            page = encoded.convert("RGBA")
            for url, frame in entries:
                x, y, w, h = (frame[key] for key in ("x", "y", "w", "h"))
                if min(x, y) < PADDING or x + w + PADDING > page.width or y + h + PADDING > page.height:
                    raise ValueError(f"Atlas frame or extrusion outside page: {url}")
                with Image.open(source_path(root, url)) as original:
                    rgba = original.convert("RGBA")
                    cropped = page.crop((x, y, x + w, y + h))
                    if rgba.size != cropped.size or rgba.tobytes() != cropped.tobytes():
                        raise ValueError(f"RGBA pixels changed: {url}")
                    # The ring must match an edge-clamped image, not a transparent gutter.
                    for actual, expected in [
                        (page.crop((x, y - 1, x + w, y)), rgba.crop((0, 0, w, 1))),
                        (page.crop((x, y + h, x + w, y + h + 1)), rgba.crop((0, h - 1, w, h))),
                        (page.crop((x - 1, y, x, y + h)), rgba.crop((0, 0, 1, h))),
                        (page.crop((x + w, y, x + w + 1, y + h)), rgba.crop((w - 1, 0, w, h))),
                    ]:
                        if actual.tobytes() != expected.tobytes():
                            raise ValueError(f"Atlas edge extrusion changed: {url}")
                        actual.close()
                        expected.close()
                    rgba.close()
                    cropped.close()
                checked += 1
            page.close()
    return {"checked": checked, "rgbaExact": checked, "sizeExact": checked, "extrusionExact": checked, "differences": 0}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--size", type=int, choices=[2048, 4096], default=2048)
    parser.add_argument("--no-verify", action="store_true", help="Skip complete RGBA validation (enabled by default).")
    args = parser.parse_args()
    try:
        summary = export(args.data.resolve(), args.out.resolve(), args.size, not args.no_verify)
    except (ValueError, OSError, KeyError) as error:
        print(f"Atlas export failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
