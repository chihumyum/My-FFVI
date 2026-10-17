"""Derive premultiplication-safe PR water palette indices; never alter source PNGs."""
import json
import math
import sys
from collections import Counter
from functools import reduce
from pathlib import Path
from PIL import Image

jobs = json.load(sys.stdin)
results = []
for job in jobs:
    target = Path(job['target'])
    metadata = Path(job['metadata'])
    if target.is_file() and metadata.is_file():
        cached = json.loads(metadata.read_text())
        with Image.open(target) as check:
            check.load()
            valid = check.size == tuple(cached['size']) and check.mode == 'RGBA'
        if valid:
            results.append({**cached, 'cached': True})
            continue
    with Image.open(job['source']) as image, Image.open(job['palette']) as palette_image:
        image = image.convert('RGBA')
        palette_image = palette_image.convert('RGBA')
        rows = [tuple(palette_image.crop((0, y, palette_image.width, y + 1)).getdata()) for y in range(palette_image.height)]
        lengths = []
        run = 1
        for y in range(1, len(rows)):
            if rows[y] == rows[y - 1]:
                run += 1
            else:
                lengths.append(run)
                run = 1
        lengths.append(run)
        band = reduce(math.gcd, lengths)
        colors = palette_image.height // band
        water_bank = colors // 2
        if colors > 16 or colors < 1:
            raise ValueError(f'PR water palette has unsupported row layout: {colors} colors')
        original = list(image.getdata())
        pixels = original.copy()
        indices = Counter()
        marker_tiles = Counter()
        alpha_zero = 0
        samples = []
        sampled_indices = set()
        for offset, pixel in enumerate(original):
            if all(channel in (0, 128) for channel in pixel):
                index = sum((channel // 128) << component for component, channel in enumerate(pixel))
                if not index:
                    continue  # Zero remains transparent; nonzero 4-bit codes address palette rows.
                if index > colors:
                    raise ValueError(f'Water palette index {index} exceeds {colors} source color bands')
                encoded = (round((index - .5) / colors * 255), 255, 255, 255)
                pixels[offset] = encoded
                indices[index] += 1
                marker_tiles[(offset // image.width // 16) * (image.width // 16) + offset % image.width // 16] += 1
                alpha_zero += int(pixel[3] == 0)
                if index not in sampled_indices:
                    sampled_indices.add(index)
                    samples.append({'x': offset % image.width, 'y': offset // image.width,
                                    'sourceRGBA': pixel, 'index': index, 'derivedRGBA': encoded,
                                    'paletteFrame0': palette_image.getpixel((0, ((index - 1 + water_bank) % colors) * band + band // 2))})
        image.putdata(pixels)
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, compress_level=9)
        result = {'sourceURL': job['sourceURL'], 'url': job['url'], 'paletteURL': job['paletteURL'],
                  'size': image.size, 'paletteSize': palette_image.size,
                  'colors': colors, 'frameCount': palette_image.width, 'rowBand': band, 'waterBankOffset': water_bank,
                  'paletteRows': [[palette_image.getpixel((x, color * band + band // 2))
                                   for x in range(palette_image.width)] for color in range(colors)],
                  'markerPixels': sum(indices.values()), 'alphaZeroMarkers': alpha_zero,
                  'indices': dict(sorted(indices.items())), 'samples': samples,
                  'markerTiles': dict(sorted(marker_tiles.items())),
                  'paletteSamples': [{'index': i, 'frame0': palette_image.getpixel((0, ((i - 1 + water_bank) % colors) * band + band // 2)),
                                      'halfCycle': palette_image.getpixel((palette_image.width // 2, ((i - 1 + water_bank) % colors) * band + band // 2))}
                                     for i in sorted(indices)],
                  'unchangedPixels': len(original) - sum(indices.values())}
        metadata.parent.mkdir(parents=True, exist_ok=True)
        metadata.write_text(json.dumps(result, separators=(',', ':')) + '\n')
        results.append({**result, 'cached': False})
print(json.dumps(results))
