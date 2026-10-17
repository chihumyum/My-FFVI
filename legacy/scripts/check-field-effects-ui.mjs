import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { prepareFieldEffectBoards, drawAxisAlignedEffectQuad } from "../apps/game/field-effect-renderer.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const compiled = process.argv.includes("--compiled-dir") ? process.argv[process.argv.indexOf("--compiled-dir") + 1] : "dist";
const { projectFieldEffects, createFieldEffectState } = await import(pathToFileURL(resolve(root, compiled, "src/core/field-effects.js")));
const { effectCatalog, effectDefinition } = await import(pathToFileURL(resolve(root, compiled, "tests/fixtures/field-effects.js")));
const { after } = projectFieldEffects(createFieldEffectState(), effectCatalog(),
  [{ kind: "create", id: "effect", definition: effectDefinition(), position: { x: 0, y: 0, z: 49 } }]);
const image = { width: 32, height: 32 }, frames = new Map([[1, { image, width: 32, height: 32, rowOrder: "top-to-bottom" }]]);
const calls = [], context = { globalAlpha: 1, imageSmoothingEnabled: true,
  save() { this.oldAlpha = this.globalAlpha; }, restore() { this.globalAlpha = this.oldAlpha; },
  drawImage(...args) { calls.push(args.slice(1)); } };
let materialReads = 0, projections = 0;
const project = (p) => { projections++; return { x: p.x, y: -p.y, z: p.z }; };
const prepareMaterial = (binding) => { materialReads++; assert.equal(binding.renderQueue, 2458); return { drawQuad: drawAxisAlignedEffectQuad }; };
const view = prepareFieldEffectBoards({ boards: after.boards, frames, project, prepareMaterial });
assert.equal(view.boardCount, 1); assert.equal(projections, 12); assert.equal(materialReads, 1);
view.draw(context);
assert.equal(projections, 12); assert.equal(materialReads, 1); assert.equal(calls.length, 3);
assert.deepEqual(calls[0], [0, 0, 32, 8, -16, -16, 32, 8]);
assert.deepEqual(calls[1], [0, 8, 32, 16, -16, -8, 32, 16]);
assert.equal(context.globalAlpha, 1);
assert.throws(() => prepareFieldEffectBoards({ boards: after.boards, frames, project }), /material\/depth host/);
assert.throws(() => prepareFieldEffectBoards({ boards: after.boards, frames: new Map(), project, prepareMaterial }), /render texture/);
const hidden = structuredClone(after.boards); hidden[0].activeSelf = false;
assert.equal(prepareFieldEffectBoards({ boards: hidden, frames: new Map(), project, prepareMaterial }).boardCount, 0);
const broken = structuredClone(after.boards); broken[0].mesh.triangles[0] = 2;
assert.throws(() => prepareFieldEffectBoards({ boards: broken, frames, project, prepareMaterial }), /topology/);
const original = context.drawImage; context.drawImage = () => { throw new Error("controlled Canvas failure"); };
assert.throws(() => view.draw(context), /Canvas failure/); assert.equal(context.globalAlpha, 1); context.drawImage = original;
const report = { formatVersion: 1, semanticsVerified: false, lane: "controlled-effect-render-texture-Canvas-adapter",
  originalGameExecuted: false, browserExecuted: false, checks: 15, draws: calls.length,
  rendererSha256: createHash("sha256").update(await readFile(resolve(root, "apps/game/field-effect-renderer.js"))).digest("hex"),
  limitations: ["No Unity particle simulation", "No source material/stencil/depth admission", "Controlled draw-call assertions, not visual parity"] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-effects-ui-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
