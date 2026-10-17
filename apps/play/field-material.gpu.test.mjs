import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { chromium } from "playwright";

test("all nonnormal PR field materials preserve black-backed waterfalls in real WebGL", async () => {
  const root = path.resolve(import.meta.dirname, "../.."),
    directory = path.join(root, "build/web-data"),
    data = JSON.parse(await readFile(path.join(directory, "data.json"))),
    rows = Object.entries(data.characters)
      .filter(([, character]) => character.animation?.data?.shader_type)
      .flatMap(([asset, character]) =>
        Object.entries(character.sprites).map(([frame, image]) => ({
          asset,
          frame,
          image,
          shaderType: character.animation.data.shader_type,
        })),
      ),
    cache = await mkdtemp(path.join(os.tmpdir(), "ffvi-field-material-gpu-")),
    entry = `
import { Application, Graphics, Sprite, TextureStyle, Assets } from "pixi.js";
import { FieldPresentation } from "/apps/play/field-presentation.js";
TextureStyle.defaultOptions.scaleMode="nearest";
const app=new Application();
await app.init({width:48,height:400,resolution:1,antialias:false,backgroundAlpha:0,preference:"webgl",autoStart:false});
document.body.append(app.canvas);
const background=[40,89,59],floor=new Graphics().rect(0,0,48,400).fill(0x28593b);
app.stage.addChild(floor);
window.fieldMaterialResults=[];
for(const row of ${JSON.stringify(rows)}){
 const texture=await Assets.load(row.image.file),sprite=new Sprite(texture),image=new Image();
 image.src=row.image.file;await image.decode();
 const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;
 const context=canvas.getContext("2d");context.drawImage(image,0,0);const source=context.getImageData(0,0,image.width,image.height).data;
 const warnings=[];
 sprite.blendMode=FieldPresentation.prototype.actorBlendMode.call({warn:(...warning)=>warnings.push(warning)},row.asset,{animation:{data:{shader_type:row.shaderType}}});
 app.stage.addChild(sprite);
 const actual=app.renderer.extract.pixels({target:app.stage});
 let black=0,colored=0,changedBlack=0,mismatches=0,maxError=0;
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
  const from=(y*image.width+x)*4,to=(y*actual.width+x)*4,alpha=source[from+3]/255;
  const isBlack=source[from]===0&&source[from+1]===0&&source[from+2]===0;
  if(isBlack)black++;else colored++;
  let bad=false;
  for(let channel=0;channel<3;channel++){
   const expected=Math.min(255,Math.round(background[channel]+source[from+channel]*alpha));
   const error=Math.abs(actual.pixels[to+channel]-expected);maxError=Math.max(maxError,error);if(error>1)bad=true;
   if(isBlack&&actual.pixels[to+channel]!==background[channel])changedBlack++;
  }
  if(bad)mismatches++;
 }
 sprite.blendMode="normal";
 sprite.blendMode=FieldPresentation.prototype.actorBlendMode.call({warn:()=>{}},"ordinary-character",{animation:{data:{shader_type:0}}});
 const normal=app.renderer.extract.pixels({target:app.stage});
 window.fieldMaterialResults.push({...row,black,colored,changedBlack,mismatches,maxError,warnings,resetMode:sprite.blendMode,normalCorner:Array.from(normal.pixels.subarray(0,4))});
 sprite.destroy();
}
app.destroy(true,{children:true});window.fieldMaterialReady=true;
`,
    server = await createServer({
      configFile: false,
      root,
      cacheDir: cache,
      publicDir: false,
      server: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "field-material-regression",
          resolveId: (id) => (id === "/__field-material.js" ? id : undefined),
          load: (id) => (id === "/__field-material.js" ? entry : undefined),
          configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
              const pathname = new URL(req.url, "http://localhost").pathname;
              if (pathname === "/") {
                res.setHeader("Content-Type", "text/html");
                return res.end('<script type="module" src="/__field-material.js"></script>');
              }
              if (!pathname.startsWith("/web-data/media/")) return next();
              const file = path.resolve(directory, pathname.slice(10));
              if (!file.startsWith(path.join(directory, "media") + path.sep)) return next();
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
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.fieldMaterialReady, null, { timeout: 30000 });
    assert.deepEqual(errors, []);
    const results = await page.evaluate(() => window.fieldMaterialResults);
    assert.equal(new Set(results.map((row) => row.asset)).size, 3);
    assert.equal(results.length, 4);
    for (const row of results) {
      assert.ok(row.black > 0 && row.colored > 0, row.asset);
      assert.equal(
        row.changedBlack,
        0,
        `Opaque source black must retain the lower terrain: ${row.asset}`,
      );
      assert.equal(row.mismatches, 0, `Waterfall RGB must remain present: ${row.asset}`);
      assert.equal(row.resetMode, "normal", "Pooled sprites must restore ordinary blending");
      assert.deepEqual(row.normalCorner, [0, 0, 0, 255]);
      assert.ok(row.warnings.some((warning) => warning[1].includes("inferred")));
    }
    if (process.env.PLAY_FIELD_MATERIAL_GPU_REPORT) {
      const report = path.resolve(process.env.PLAY_FIELD_MATERIAL_GPU_REPORT);
      await mkdir(path.dirname(report), { recursive: true });
      await writeFile(report, JSON.stringify({ engine: "chromium-webgl", results }, null, 2));
    }
  } finally {
    await browser?.close();
    await server.close();
    await rm(cache, { recursive: true, force: true });
  }
});
