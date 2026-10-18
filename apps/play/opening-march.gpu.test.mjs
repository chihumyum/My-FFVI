import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

test("opening scenery retains its complete atlas regions under the real outer screen filter", async () => {
  const root = path.resolve(import.meta.dirname, "../.."),
    cache = await mkdtemp(path.join(os.tmpdir(), "ffvi-opening-gpu-")),
    entry = `
import { Application, Container, Rectangle, Texture, TextureStyle } from "pixi.js";
import { OpeningMarch } from "/apps/play/opening-march.js";
import { FieldPresentation } from "/apps/play/field-presentation.js";
TextureStyle.defaultOptions.scaleMode = "nearest";
const atlas = document.createElement("canvas"); atlas.width = atlas.height = 256;
const paint = atlas.getContext("2d");
paint.fillStyle = "#102040"; paint.fillRect(8,8,128,32);
paint.fillStyle = "#f0b040"; paint.fillRect(8,40,128,32);
paint.fillStyle = "#8090a0"; paint.fillRect(8,96,128,128);
const base = Texture.from(atlas),
  sky = new Texture({source:base.source,frame:new Rectangle(8,8,128,64)}),
  ground = new Texture({source:base.source,frame:new Rectangle(8,96,128,128)}),
  results = [];
for (const resolution of [1,2,3,6]) {
  const app = new Application();
  await app.init({width:320,height:180,resolution,preference:"webgl",autoStart:false,antialias:false,useBackBuffer:true});
  const world = new Container(), layers = Object.fromEntries(["far","mapLayers","actors","near","effects"].map(k=>[k,new Container()]));
  world.addChild(...Object.values(layers)); world.filterArea = new Rectangle(0,0,320,180); app.stage.addChild(world);
  const field = new FieldPresentation({layers,getTexture:()=>null,warn:()=>{}});
  world.filters = [field.screenFilter];
  const march = new OpeningMarch({parent:layers.near,getTexture:url=>url==="sky"?sky:ground,sample:()=>{},warn:()=>{},diagnostics:{record:()=>{}}});
  march.draw({map:{textures:{ground:"ground"},tilesets:[{image:"ground"}]},camera:{x:16,y:28},time:7,actors:new Map()},{characters:{}},{sky:{nalshe_op:{url:"sky"}}},app.renderer);
  app.render();
  const copy = document.createElement("canvas"); copy.width=320;copy.height=180;
  const ctx = copy.getContext("2d");ctx.imageSmoothingEnabled=false;ctx.drawImage(app.canvas,0,0,320,180);
  const pixel=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
  results.push({resolution,sky:pixel(153,41),horizon:pixel(161,75),ground:pixel(167,159)});
  world.filters = null; march.destroy(); field.destroy(); app.destroy(true,{children:true,texture:false,textureSource:false});
}
window.result=results;
`,
    server = await createServer({
      configFile: false,
      root,
      cacheDir: cache,
      publicDir: false,
      server: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "opening-background-regression",
          resolveId: (id) => (id === "/__opening-gpu.js" ? id : undefined),
          load: (id) => (id === "/__opening-gpu.js" ? entry : undefined),
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (req.url !== "/") return next();
              res.setHeader("Content-Type", "text/html");
              res.end('<script type="module" src="/__opening-gpu.js"></script>');
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
    const results = await page.evaluate(() => window.result);
    for (const row of results)
      for (const [part, expected] of [
        ["sky", [16, 32, 64, 255]],
        ["horizon", [240, 176, 64, 255]],
        ["ground", [54, 66, 99, 255]],
      ])
        assert.ok(
          row[part].every((value, i) => Math.abs(value - expected[i]) <= 2),
          `The complete ${part} must survive nested composition at resolution ${row.resolution}: ${JSON.stringify(row)}`,
        );
  } finally {
    await browser?.close();
    await server.close();
    await rm(cache, { recursive: true, force: true });
  }
});
