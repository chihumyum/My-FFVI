import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { chromium } from "playwright";
import { inspectWaterMaterials } from "../../tools/play/check-water-materials.mjs";

const root = path.resolve(import.meta.dirname, "../.."),
  data = path.join(root, "build/web-data");

test("real WebGL water keeps offset back-buffer pixels, lights black pools, and obeys source fade", async () => {
  const materials = await Promise.all(
      [38, 499].map(async (id) => {
        const map = JSON.parse(await readFile(path.join(data, `maps/${id}.json`)));
        return map.layers.find((layer) => layer.sourceGroup === "WaterGroup").waterMaterial;
      }),
    ),
    audit = await inspectWaterMaterials(),
    controlManifest = JSON.parse(await readFile(path.join(data, "raw/water-controls.json"))),
    actualMaps = await Promise.all(
      audit.layers.map(async (row) => {
        const map = JSON.parse(await readFile(path.join(data, `maps/${row.mapId}.json`))),
          layer = map.layers.find((layer) => layer.name === row.layer);
        return {
          mapId: row.mapId,
          layer: layer.name,
          material: layer.waterMaterial,
          paletteRows: layer.waterMaterial.palette
            ? controlManifest.images.find(
                (image) => image.paletteURL === layer.waterMaterial.palette.url,
              ).paletteRows
            : null,
          opacity: layer.opacity ?? 1,
          crops: [
            ...new Set(layer.data.filter(Boolean).map((gid) => (gid >>> 0) & 0x0fffffff)),
          ].map((gid) => {
            const set = [...map.tilesets].reverse().find((set) => set.firstgid <= gid),
              index = gid - set.firstgid,
              tile = set.tilewidth || map.tileSize,
              margin = set.margin || 0,
              spacing = set.spacing || 0;
            return {
              url: layer.waterMaterial.controlTextures?.[set.image]?.url || map.textures[set.image],
              gid,
              x: margin + (index % set.columns) * (tile + spacing),
              y: margin + Math.floor(index / set.columns) * (tile + spacing),
              width: tile,
              height: set.tileheight || map.tileSize,
            };
          }),
        };
      }),
    ),
    cache = await mkdtemp(path.join(os.tmpdir(), "ffvi-water-gpu-")),
    entry = `
import { Application, Container, Graphics, Sprite, Texture, TextureStyle, Assets, Rectangle } from "pixi.js";
import { WaterMaterial } from "/apps/play/water-material.js";
TextureStyle.defaultOptions.scaleMode="nearest";
const materials=${JSON.stringify(materials)};
const actualMaps=${JSON.stringify(actualMaps)};
const controlManifest=${JSON.stringify(controlManifest)};
const textures=new Map();
for(const image of Object.values(materials[0].textures)) textures.set(image.url,await Assets.load(image.url));
for(const row of actualMaps)if(row.material.palette&&!textures.has(row.material.palette.url))textures.set(row.material.palette.url,await Assets.load(row.material.palette.url));
window.waterResult=[];
for(const resolution of [1,3]){
 const app=new Application();
 await app.init({width:96,height:64,resolution,antialias:false,background:0,preference:"webgl",useBackBuffer:true,autoStart:false});
 document.body.append(app.canvas);
 const floor=new Graphics();app.stage.addChild(floor);
 const controls=new Container(), sprite=new Sprite(Texture.WHITE);
 sprite.tint=0x0000ff;sprite.position.set(16,16);sprite.width=64;sprite.height=32;
 controls.addChild(sprite);app.stage.addChild(controls);
 let collectAll=false;const warnings=[];
 const water=new WaterMaterial({getTexture:url=>textures.get(url),warn:(...values)=>warnings.push(values),collectAll:()=>collectAll});
 controls.filters=[water];
 const identity={water_blend_ratio:0,base_color_brightness:1,base_color_saturation:1,condensing_pattern_intensity:0,highlight_intensity:0,reflection_intensity:0,noise_magnification:0};
 const sample=()=>{app.render();const output=app.renderer.extract.pixels({target:app.stage});return [[32,32],[64,32],[8,8]].map(([x,y])=>Array.from(output.pixels.subarray(((y*resolution)*output.width+x*resolution)*4,((y*resolution)*output.width+x*resolution)*4+4)));};
 floor.rect(0,0,48,64).fill(0xc03020).rect(48,0,48,64).fill(0x20b040);
 water.update({...materials[0],properties:identity},{time:3,scale:1});const unchanged=sample();
 sprite.tint=0x000000;water.update(materials[0],{time:3,scale:1});const bank=sample();sprite.tint=0x0000ff;
 const initialWarnings=warnings.length;
 water.update({...materials[0],properties:identity},{time:3,scale:1});const repeatedWarnings=warnings.length;
 collectAll=true;water.update({...materials[0],properties:identity},{time:3,scale:1});const acceptanceWarnings=warnings.length;
 floor.clear().rect(0,0,96,64).fill(0x000000);
 water.update(materials[0],{time:3,scale:1});const pool=sample();
 water.update(materials[1],{time:3,scale:1});const lava=sample();
 water.update(materials[1],{time:3,scale:1,properties:{"_WaterColor:A":{from:255,to:0,time:0,duration:3,layer:-1}}});const drained=sample();
 window.waterResult.push({resolution,unchanged,bank,pool,lava,drained,initialWarnings,repeatedWarnings,acceptanceWarnings});
 controls.filters=null;water.destroy();app.destroy(true,{children:true});
}
const actual=new Application();
await actual.init({width:256,height:320,resolution:1,antialias:false,backgroundAlpha:0,preference:"webgl",useBackBuffer:true,autoStart:false});
document.body.append(actual.canvas);window.actualMapWaterAlpha=[];
let currentURL,source;
for(const row of actualMaps){
 const controls=new Container();controls.alpha=row.opacity;actual.stage.addChild(controls);
 const crops=[];
 for(const [i,crop] of row.crops.entries()){
  if(currentURL!==crop.url){source=await Assets.load(crop.url);currentURL=crop.url;}
  const texture=new Texture({source:source.source,frame:new Rectangle(crop.x,crop.y,crop.width,crop.height)});crops.push(texture);
  const sprite=new Sprite(texture);sprite.position.set(i%16*16,Math.floor(i/16)*16);controls.addChild(sprite);
 }
 const before=actual.renderer.extract.pixels({target:actual.stage});
 const water=new WaterMaterial({getTexture:url=>textures.get(url),warn:()=>{}});
 water.update(row.material,{time:3,scale:1,layerName:row.layer,mapId:row.mapId});controls.filters=[water];
 const after=actual.renderer.extract.pixels({target:actual.stage});
 let lost=0,covered=0,maxError=0,paletteTransparentPixels=0;const examples=[];
 for(let offset=3;offset<before.pixels.length;offset+=4){
  if(before.pixels[offset]===0)continue;covered++;
  let expected=before.pixels[offset];
  if(row.material.palette){const r=before.pixels[offset-3]/expected,g=before.pixels[offset-2]/expected,b=before.pixels[offset-1]/expected,palette=row.material.palette,index=Math.floor(r*palette.colors)+1;
   if(r>.005&&g>.99&&b>.99&&index<=palette.colors){const frame=Math.floor(3*palette.speed*palette.frameCount)%palette.frameCount;expected=Math.round(expected*row.paletteRows[(index-1+palette.bankOffset)%palette.colors][frame][3]/255);if(!expected)paletteTransparentPixels++;}
  }
  const error=Math.abs(expected-after.pixels[offset]);maxError=Math.max(maxError,error);
  if(error>1){lost++;if(examples.length<3)examples.push({x:(offset-3)/4%before.width,y:Math.floor((offset-3)/4/before.width),sourceAlpha:before.pixels[offset],renderedAlpha:after.pixels[offset],sourceRGB:Array.from(before.pixels.subarray(offset-3,offset))});}
 }
 window.actualMapWaterAlpha.push({mapId:row.mapId,layer:row.layer,tiles:row.crops.length,covered,paletteTransparentPixels,lost,maxError,examples});
 controls.filters=null;water.destroy();controls.destroy({children:true});for(const crop of crops)crop.destroy(false);
}
actual.destroy(true,{children:true});
const paletteApp=new Application();await paletteApp.init({width:32,height:32,resolution:1,antialias:false,background:0,preference:"webgl",useBackBuffer:true,autoStart:false});document.body.append(paletteApp.canvas);
window.paletteResults=[];
for(const image of controlManifest.images){
 const example=image.samples.find((sample)=>sample.sourceRGBA[3]===0);
 const source=await Assets.load(image.url),pixel=new Texture({source:source.source,frame:new Rectangle(example.x,example.y,1,1)}),sprite=new Sprite(pixel),controls=new Container();
 sprite.width=16;sprite.height=16;sprite.position.set(8,8);controls.addChild(sprite);paletteApp.stage.addChild(controls);
 const material=actualMaps.find((row)=>row.material.palette?.url===image.paletteURL).material;
 const water=new WaterMaterial({getTexture:url=>textures.get(url),warn:()=>{}});controls.filters=[water];
 const colors=[];
 for(const time of [0,.5]){
  water.update({...material,properties:{custom_water_color:"#ffff0000",use_custom_water_color:true,water_blend_ratio:1,reflection_intensity:0,highlight_intensity:0,condensing_pattern_intensity:0,noise_magnification:0},palette:{...material.palette,speed:1}},{time,scale:1});
  const output=paletteApp.renderer.extract.pixels({target:paletteApp.stage});colors.push(Array.from(output.pixels.subarray((16*32+16)*4,(16*32+16)*4+4)));
 }
 const expected=image.paletteSamples.find((sample)=>sample.index===example.index);
 window.paletteResults.push({sourceURL:image.sourceURL,index:example.index,originalRGBA:example.sourceRGBA,derivedRGBA:example.derivedRGBA,actual:colors,expected:[expected.frame0,expected.halfCycle].map((pixel)=>[Math.round(Math.max(...pixel.slice(0,3))*pixel[3]/255),0,0,255])});
 controls.filters=null;water.destroy();controls.destroy({children:true});pixel.destroy(false);
}
paletteApp.destroy(true,{children:true});
window.waterReady=true;
`,
    server = await createServer({
      configFile: false,
      root,
      cacheDir: cache,
      publicDir: false,
      server: { host: "127.0.0.1", port: 0, strictPort: false },
      plugins: [
        {
          name: "water-gpu-bug-fixture",
          resolveId(id) {
            if (id === "/__water-entry.js") return id;
          },
          load(id) {
            if (id === "/__water-entry.js") return entry;
          },
          configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
              const pathname = new URL(req.url, "http://localhost").pathname;
              if (pathname === "/") {
                res.setHeader("Content-Type", "text/html");
                return res.end('<script type="module" src="/__water-entry.js"></script>');
              }
              if (!pathname.startsWith("/web-data/media/")) return next();
              const file = path.resolve(data, pathname.slice(10));
              if (!file.startsWith(path.join(data, "media") + path.sep)) return next();
              try {
                res.setHeader("Content-Type", "image/png");
                res.end(await readFile(file));
              } catch {
                res.statusCode = 404;
                res.end();
              }
            });
          },
        },
      ],
    });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      headless: true,
      args: process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    const page = await browser.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page
      .waitForFunction(() => window.waterReady, null, { timeout: 20000 })
      .catch((error) => {
        throw Error(errors.join("\n") || error.message);
      });
    const { results, actualMapAlpha, paletteResults } = await page.evaluate(() => ({
      results: window.waterResult,
      actualMapAlpha: window.actualMapWaterAlpha,
      paletteResults: window.paletteResults,
    }));
    assert.deepEqual(errors, []);
    for (const row of results) {
      assert.deepEqual(row.unchanged, [
        [192, 48, 32, 255],
        [32, 176, 64, 255],
        [192, 48, 32, 255],
      ]);
      assert.deepEqual(
        row.bank,
        row.unchanged,
        "black RGB controls must not reflect water over the original bank wall",
      );
      assert.equal(row.initialWarnings, row.repeatedWarnings, "normal mode warns once");
      assert.ok(
        row.acceptanceWarnings > row.repeatedWarnings,
        "new acceptance fixtures retain diagnostics",
      );
      assert.ok(
        row.pool[0][2] > 15 && row.pool[0][2] > row.pool[0][0],
        "source black floor needs a lit blue water surface",
      );
      assert.ok(
        row.lava[0][0] >= 200 && row.lava[0][2] < 10,
        "PR source lava is orange, not controller blue or black",
      );
      assert.deepEqual(
        row.drained[0],
        [0, 0, 0, 255],
        "source alpha command reveals the real lower floor",
      );
    }
    assert.equal(actualMapAlpha.length, 62);
    assert.equal(actualMaps.filter((row) => row.material.palette).length, 11);
    assert.equal(paletteResults.length, controlManifest.images.length);
    for (const row of paletteResults) {
      assert.equal(
        row.originalRGBA[3],
        0,
        "real PR sample stores a meaningful index in zero-alpha source RGB",
      );
      for (const [i, actual] of row.actual.entries())
        assert.ok(
          actual.every((value, channel) => Math.abs(value - row.expected[i][channel]) <= 1),
          `palette lookup differs from original PNG colors: ${JSON.stringify(row)}`,
        );
    }
    if (process.env.PLAY_WATER_GPU_REPORT) {
      const file = path.resolve(process.env.PLAY_WATER_GPU_REPORT);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify(
          {
            scope:
              "Actual PR water-controller PNG crops for all runtime water layers; direct alpha and decoded source palette alpha plus exact palette-color lookup, not original-game scene equivalence.",
            summary: {
              layers: actualMapAlpha.length,
              sourceTileCrops: actualMapAlpha.reduce((sum, row) => sum + row.tiles, 0),
              coveredPixels: actualMapAlpha.reduce((sum, row) => sum + row.covered, 0),
              alphaMismatches: actualMapAlpha.reduce((sum, row) => sum + row.lost, 0),
            },
            syntheticInputs: results,
            sourcePaletteComparisons: paletteResults,
            layers: actualMapAlpha,
          },
          null,
          2,
        ) + "\n",
      );
    }
    assert.deepEqual(
      actualMapAlpha.filter((row) => row.lost),
      [],
      "every real PR water-controller crop must preserve its authored nonzero alpha, including opaque black RGB",
    );
  } finally {
    await browser?.close();
    await server.close();
    await rm(cache, { recursive: true, force: true });
  }
});
