import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildExtrasPreviews } from "./extras-previews.mjs";

const python = path.resolve(import.meta.dirname, "../../.venv/bin/python");
test("gallery previews preserve aspect ratio, original data and an unchanged cache", async () => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "ffvi-preview-"));
  try {
    await mkdir(path.join(dataRoot, "media"));
    const source = path.join(dataRoot, "media/original.png");
    const made = spawnSync(python, [
      "-c",
      "from PIL import Image;import sys;Image.new('RGBA',(1024,512),(31,84,149,255)).save(sys.argv[1])",
      source,
    ]);
    assert.equal(made.status, 0, String(made.stderr));
    const original = await readFile(source);
    await writeFile(
      path.join(dataRoot, "extras.json"),
      JSON.stringify({
        gallery: [{ image: { url: "/web-data/media/original.png", width: 1024, height: 512 } }],
      }),
    );
    const first = await buildExtrasPreviews({ dataRoot, python });
    const image = first.images["/web-data/media/original.png"];
    assert.deepEqual([image.width, image.height], [512, 256]);
    const output = path.join(dataRoot, image.url.slice("/web-data/".length));
    const decoded = spawnSync(
      python,
      [
        "-c",
        "from PIL import Image;import sys,json;i=Image.open(sys.argv[1]);print(json.dumps([*i.size,*i.getpixel((0,0))]))",
        output,
      ],
      { encoding: "utf8" },
    );
    assert.equal(decoded.status, 0, decoded.stderr);
    assert.deepEqual(JSON.parse(decoded.stdout), [512, 256, 31, 84, 149, 255]);
    const modified = (await stat(output)).mtimeMs;
    assert.deepEqual(await buildExtrasPreviews({ dataRoot, python }), first);
    assert.equal((await stat(output)).mtimeMs, modified);
    assert.deepEqual(await readFile(source), original);
    await writeFile(
      path.join(dataRoot, "extras.json"),
      JSON.stringify({
        gallery: [{ image: { url: "/web-data/../escape.png", width: 1, height: 1 } }],
      }),
    );
    await assert.rejects(buildExtrasPreviews({ dataRoot, python }), /leaves data directory/);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
