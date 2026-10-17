import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("a content proof is invalidated by changed production styling or HTML as well as executable code", async () => {
  const { runtimeDigest } = await import(new URL("../../scripts/runtime-digest.mjs", import.meta.url).href);
  const root = await mkdtemp(resolve(tmpdir(), "ffvi-runtime-proof-"));
  try {
    for (const directory of ["dist/src", "dist/tests", "apps/game", "scripts"])
      await mkdir(resolve(root, directory), { recursive: true });
    const style = resolve(root, "apps/game/style.css"), entry = resolve(root, "apps/game/index.html");
    await writeFile(style, "#dialogue { overflow: auto; }");
    await writeFile(entry, '<div id="dialogue"></div>');
    const initial = await runtimeDigest(root);
    await writeFile(style, "#dialogue { overflow: hidden; }");
    const changedStyle = await runtimeDigest(root);
    assert.notEqual(changedStyle, initial, "Clipped dialogue must invalidate the prior content proof");
    await writeFile(entry, '<div id="other"></div>');
    const changedEntry = await runtimeDigest(root);
    assert.notEqual(changedEntry, changedStyle, "A changed production mount must invalidate the prior proof");
    await writeFile(resolve(root, "apps/game/app.js"), "throw new Error('changed runtime');");
    assert.notEqual(await runtimeDigest(root), changedEntry);
  } finally { await rm(root, { recursive: true, force: true }); }
});
