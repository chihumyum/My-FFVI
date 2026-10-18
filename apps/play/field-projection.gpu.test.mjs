import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "vite";
import { chromium } from "playwright";

test("world projection samples the original map plane before downscaling at every resolution", async () => {
  const cache = await mkdtemp(path.join(os.tmpdir(), "ffvi-projection-gpu-")),
    entry = `
import { Application, Container, Graphics, Texture, TextureStyle } from "pixi.js";
import { FieldPresentation } from "/apps/play/field-presentation.js";
TextureStyle.defaultOptions.scaleMode="nearest";
window.projectionResults=[];
for(const resolution of [1,2,3]){
 const app=new Application();await app.init({width:320,height:180,resolution,antialias:false,backgroundAlpha:0,preference:"webgl",autoStart:false});document.body.append(app.canvas);
 const layers=Object.fromEntries(["far","mapLayers","actors","near","effects"].map(k=>[k,new Container()]));
 for(const layer of Object.values(layers))app.stage.addChild(layer);
 const view=new FieldPresentation({layers,getTexture:()=>Texture.WHITE,warn:()=>{}});
 const terrain=new Graphics();for(let x=0;x<640;x++)terrain.rect(x,0,1,640).fill(x%2?0xff0000:0x0000ff);layers.mapLayers.addChild(terrain);
 view.setCatalog({warnings:[],sky:{},flight:{ships:{}}});
 view.flight=true;view.flightSize={width:640,height:360};view.flightState={rotation:0,altitude:0,upDown:0};view.flightHeight=1;view._data={characters:{}};
 view.project(app.renderer,layers,{map:{name:"Map_10010"},time:0,player:{visible:false,direction:"up"}});app.render();
 const out=app.renderer.extract.pixels({target:app.stage});let red=0,blue=0,total=0;
 for(let y=120;y<170;y++)for(let x=20;x<300;x++){
  const at=(y*resolution*out.width+x*resolution)*4,r=out.pixels[at],b=out.pixels[at+2];total++;if(r>b+100)red++;if(b>r+100)blue++;
 }
 window.projectionResults.push({resolution,red,blue,total});view.destroy();app.destroy(true,{children:true});
}
window.projectionReady=true;
`,
    server = await createServer({
      configFile: false,
      root: path.resolve(import.meta.dirname, "../.."),
      cacheDir: cache,
      publicDir: false,
      server: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "projection-regression-fixture",
          resolveId: (id) => (id === "/__projection.js" ? id : undefined),
          load: (id) => (id === "/__projection.js" ? entry : undefined),
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (req.url !== "/") return next();
              res.setHeader("Content-Type", "text/html");
              res.end('<script type="module" src="/__projection.js"></script>');
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
    await page.waitForFunction(() => window.projectionReady, null, { timeout: 60000 });
    assert.deepEqual(errors, []);
    const results = await page.evaluate(() => window.projectionResults);
    assert.equal(results.length, 3);
    for (const row of results) {
      assert.ok(row.red > row.total * 0.2, JSON.stringify(row));
      assert.ok(row.blue > row.total * 0.2, JSON.stringify(row));
    }
  } finally {
    await browser?.close();
    await server.close();
    await rm(cache, { recursive: true, force: true });
  }
});
