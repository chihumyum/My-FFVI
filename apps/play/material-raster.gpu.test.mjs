import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { chromium } from "playwright";

test("tiled particle materials retain source-sized wave detail after GPU caching", async () => {
  const root = path.resolve(import.meta.dirname, "../.."),
    cache = await mkdtemp(path.join(os.tmpdir(), "ffvi-material-raster-")),
    entry = `
import { Application, Sprite, Texture, TextureStyle } from "pixi.js";
import { PRMaterialCache, PRFilter } from "/apps/play/pr-filters.js";
TextureStyle.defaultOptions.scaleMode="nearest";
const canvas=document.createElement("canvas");canvas.width=64;canvas.height=8;
const ctx=canvas.getContext("2d");
for(let x=0;x<64;x++){ctx.fillStyle=x%2?"white":"black";ctx.fillRect(x,0,1,8);}
const source=Texture.from(canvas),app=new Application();
await app.init({width:640,height:8,preference:"webgl",antialias:false,autoStart:false,resolution:1});
const cache=new PRMaterialCache({renderer:app.renderer,getTexture:()=>source,warn:()=>{}});
const material={name:"tiled-wave-test",textures:{_MainTex:{url:"source",width:64,height:8,scale:[1,1]}},floats:{_TileX:10,_TileY:1,_UseGradient:1},colors:{_GradientBlackColor:[0,0,0,1],_GradientWhiteColor:[1,1,1,1]}};
cache.beginFrame();const baked=cache.get(material,1),sprite=new Sprite(baked);sprite.width=640;sprite.height=8;app.stage.addChild(sprite);app.render();
const output=app.renderer.extract.pixels({target:app.stage}),values=[];
for(let x=0;x<640;x++)values.push(output.pixels[(4*output.width+x)*4]);
const result={changes:values.slice(1).filter((value,index)=>Math.abs(value-values[index])>200).length,minimum:Math.min(...values),maximum:Math.max(...values),alphaMin:Math.min(...Array.from({length:640},(_,x)=>output.pixels[(4*output.width+x)*4+3]))};
app.stage.removeChild(sprite);sprite.destroy();cache.destroy();
ctx.clearRect(0,0,64,8);ctx.fillStyle="#00ff00";ctx.fillRect(32,0,32,8);
const waves=Texture.from(canvas);waves.source.update();
const ocean=new PRFilter("Last/WorldmapFarBgWarterSurfaceShader",{width:640,height:8,getTexture:()=>Texture.WHITE,warn:()=>{},material:{colors:{_OceanBaseColor:[.1,.1,.25,1],_OceanAddColor:[.26,.09,.39,1]}}});
ocean.update(0,{width:640,height:8});
const sea=new Sprite(waves);sea.width=640;sea.height=8;sea.filters=[ocean];app.stage.addChild(sea);app.render();
const oceanPixels=app.renderer.extract.pixels({target:app.stage});
result.oceanAlphaMin=Math.min(...Array.from({length:640},(_,x)=>oceanPixels.pixels[(4*oceanPixels.width+x)*4+3]));
result.calmOcean=Array.from(oceanPixels.pixels.slice((4*oceanPixels.width+8)*4,(4*oceanPixels.width+8)*4+4));
window.result=result;
app.destroy(true,{children:true});ocean.destroy();
`,
    server = await createServer({
      configFile: false,
      root,
      cacheDir: cache,
      publicDir: false,
      server: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "material-raster-regression",
          resolveId: (id) => (id === "/__material-raster.js" ? id : undefined),
          load: (id) => (id === "/__material-raster.js" ? entry : undefined),
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (req.url !== "/") return next();
              res.setHeader("Content-Type", "text/html");
              res.end('<script type="module" src="/__material-raster.js"></script>');
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
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.result);
    const result = await page.evaluate(() => window.result);
    assert.ok(
      result.changes >= 620,
      `Repeated one-pixel waves cannot collapse to large blocks: ${JSON.stringify(result)}`,
    );
    assert.equal(result.minimum, 0);
    assert.equal(result.maximum, 255);
    assert.equal(result.alphaMin, 255);
    assert.equal(result.oceanAlphaMin, 255, "Calm gaps in a control texture are opaque ocean");
    assert.ok(result.calmOcean[2] > 20, "The source ocean base color survives alpha-zero controls");
  } finally {
    await browser?.close();
    await server.close();
    await rm(cache, { recursive: true, force: true });
  }
});
