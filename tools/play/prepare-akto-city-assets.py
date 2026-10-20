"""Pack generated small-cell atlases; no scene painting or original-asset export."""
import json
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'build/play/deployment/akto-city'
OLD = ROOT / 'build/play/deployment/akto-art-test'
(OUT / 'assets').mkdir(parents=True, exist_ok=True)
modules = json.loads((OLD / 'asset-manifest.json').read_text())['modules']
import shutil
for file in (OLD / 'assets').glob('*.png'):
    shutil.copy2(file, OUT / 'assets' / file.name)
checks = []
sky_raw = Image.open(OUT / 'raw/sky.png').convert('RGBA')
sky_base = sky_raw.crop((sky_raw.width//2,0,sky_raw.width//2+1,sky_raw.height)).resize((16,64),Image.Resampling.NEAREST)
sky_base.putalpha(255)
for name in ['stone', 'canopy', 'garden', 'props', 'mechanics', 'giant', 'horizon']:
    source = Image.open(OUT / 'raw' / f'{name}.png').convert('RGBA')
    source.putalpha(source.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
    atlas = Image.new('RGBA', (128, 128))
    for n in range(16):
        col, row = n % 4, n // 4
        left, top = round(col*source.width/4), round(row*source.height/4)
        right, bottom = round((col+1)*source.width/4), round((row+1)*source.height/4)
        # The canopy's pole begins above its nominal row; preserve its cap.
        if name == 'canopy' and n == 12:
            top = round(source.height*.702)
        cell = source.crop((left, top, right, bottom))
        opaque = name == 'stone' or (name == 'horizon' and row == 0) or (name == 'mechanics' and n in [4,5])
        bbox = cell.getchannel('A').getbbox()
        if name == 'canopy' and row == 0:
            cell = cell.crop(bbox).resize((32,32),Image.Resampling.NEAREST)
        elif name == 'canopy' and row in [1,2]:
            edge = cell.crop(bbox).resize((32,16),Image.Resampling.NEAREST)
            cell = Image.new('RGBA',(32,32))
            cell.alpha_composite(edge,(0,16 if row == 1 else 0))
        elif name == 'horizon' and row == 0:
            cell = sky_base.crop((0,col*16,16,(col+1)*16)).resize((32,32),Image.Resampling.NEAREST)
        elif name == 'mechanics' and n in [0,1,2,3,12]:
            cell = cell.resize((32,32),Image.Resampling.NEAREST)
        elif opaque:
            if bbox:
                cell = cell.crop(bbox)
            cell = cell.crop((3,3,cell.width-3,cell.height-3)).resize((32,32), Image.Resampling.NEAREST)
        elif bbox:
            cell = cell.crop(bbox)
            ratio = min(30/cell.width, 30/cell.height)
            size = (max(1,round(cell.width*ratio)),max(1,round(cell.height*ratio)))
            cell = cell.resize(size,Image.Resampling.NEAREST)
            target = Image.new('RGBA',(32,32))
            target.alpha_composite(cell,((32-cell.width)//2,32-cell.height))
            cell = target
        else:
            raise ValueError(f'Empty cell {name}:{n}')
        # Quantize alpha only. Preserve the generated RGB pixel clusters.
        cell.putalpha(cell.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
        atlas.alpha_composite(cell,(col*32,row*32))
    atlas.save(OUT / 'assets' / f'{name}.png')
    assert Image.open(OUT / 'assets' / f'{name}.png').tobytes() == atlas.tobytes()
    modules[name] = {'file':f'assets/{name}.png','width':128,'height':128,'cellSize':32}
    if name in ['giant','mechanics','horizon']:
        large = atlas.resize((256,256),Image.Resampling.NEAREST)
        large.save(OUT / 'assets' / f'{name}-large.png')
        modules[name+'Large'] = {'file':f'assets/{name}-large.png','width':256,'height':256,'cellSize':64,'derivedFrom':name}
    checks.append({'name':name,'rawSize':list(source.size),'atlasSize':[128,128],
                   'cells':16,'mapTileSize':16,'alphaValues':sorted(set(atlas.getchannel('A').getdata())),
                   'bytes':(OUT / 'raw' / f'{name}.png').stat().st_size})
water = Image.open(OUT / 'assets/water.png').convert('RGBA')
flow = Image.new('RGBA',(64,128)); flow.paste(water,(0,0)); flow.paste(ImageChops.offset(water,2,0),(0,64));flow.save(OUT / 'assets/water-flow.png')
modules['waterFlow'] = {'file':'assets/water-flow.png','width':64,'height':128,'derivedFrom':'water'}
sky_raw = Image.open(OUT / 'raw/sky.png').convert('RGBA')
# A central vertical strip guarantees exact horizontal wrap; no scene pixels are painted.
sky_base = sky_raw.crop((sky_raw.width//2,0,sky_raw.width//2+1,sky_raw.height)).resize((16,64),Image.Resampling.NEAREST)
sky_base.putalpha(255)
seam_delta = sum(sky_base.getpixel((0,y)) != sky_base.getpixel((15,y)) for y in range(64))
assert seam_delta == 0
sky_base.save(OUT / 'assets/sky-strip.png')
sky_base.resize((16,256),Image.Resampling.NEAREST).save(OUT / 'assets/sky.png')
modules['sky'] = {'file':'assets/sky.png','width':16,'height':256,'baseSize':[16,64]}
checks.append({'name':'sky','rawSize':list(sky_raw.size),'atlasSize':[16,256],'cells':4,'mapTileSize':16,'alphaValues':[255],'bytes':(OUT / 'raw/sky.png').stat().st_size,'horizontalSeamPixelsDifferent':seam_delta})
(OUT / 'asset-manifest.json').write_text(json.dumps({'modules':modules,'newAtlases':8,'newCells':116,'replacedSkyCells':4},ensure_ascii=False,indent=2))
(OUT / 'asset-check.json').write_text(json.dumps({'checks':checks,'conversion':'Crop generated cells; nearest-neighbor normalization to32; binary alpha. Maps assembled from16px tiles. AI raw files do not guarantee exact cell bounds.'},ensure_ascii=False,indent=2))
print(json.dumps({'atlases':8,'smallCells':116,'replacedSkyCells':4}))
