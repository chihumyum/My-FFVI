import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

const project = path.resolve(import.meta.dirname, "../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 24);
const pythonSource = `import json,sys
from pathlib import Path
from PIL import Image
jobs=json.load(sys.stdin)
written=0
for job in jobs:
    target=Path(job['target'])
    reusable=False
    if target.is_file():
        try:
            with Image.open(target) as image:
                image.load()
                reusable=image.size==(job['width'],job['height']) and image.mode=='RGBA'
        except OSError:
            pass
    if reusable:
        continue
    with Image.open(job['source']) as source:
        image=source.convert('RGBA').resize((job['width'],job['height']),Image.Resampling.LANCZOS)
        image.save(target,format='PNG',compress_level=9)
        image.close()
    written+=1
print(json.dumps({'written':written,'cached':len(jobs)-written}))
`;

export async function buildExtrasPreviews({
  dataRoot = path.join(project, "build/web-data"),
  python = path.join(project, ".venv/bin/python"),
} = {}) {
  dataRoot = path.resolve(dataRoot);
  const catalog = JSON.parse(await readFile(path.join(dataRoot, "extras.json"), "utf8")),
    check = spawnSync(python, ["-c", "import PIL;print(PIL.__version__)"], { encoding: "utf8" });
  if (check.status !== 0)
    throw Error(`Pillow is required for extras previews: ${check.stderr || check.error}`);
  const profile = hash(
    Buffer.concat([
      await readFile(import.meta.filename),
      Buffer.from(check.stdout.trim() + ":512x288:RGBA:LANCZOS:PNG9"),
    ]),
  );
  await mkdir(path.join(dataRoot, "previews"), { recursive: true });
  const images = {},
    jobs = [];
  for (const entry of catalog.gallery) {
    const original = entry.image;
    if (!original?.url?.startsWith("/web-data/"))
      throw Error(`Invalid gallery URL ${original?.url}`);
    const source = path.resolve(dataRoot, original.url.slice("/web-data/".length));
    if (!source.startsWith(dataRoot + path.sep))
      throw Error(`Gallery source leaves data directory: ${original.url}`);
    const bytes = await readFile(source),
      scale = Math.min(1, 512 / original.width, 288 / original.height),
      width = Math.max(1, Math.round(original.width * scale)),
      height = Math.max(1, Math.round(original.height * scale)),
      name = hash(Buffer.concat([Buffer.from(profile), bytes])) + ".png";
    const relative = `previews/${name}`;
    images[original.url] = { url: `/web-data/${relative}`, width, height };
    jobs.push({ source, target: path.join(dataRoot, relative), width, height });
  }
  const result = spawnSync(python, ["-c", pythonSource], {
    input: JSON.stringify(jobs),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0)
    throw Error(`Extras preview generation failed: ${result.stderr || result.error}`);
  const cache = JSON.parse(result.stdout),
    files = [...new Set(jobs.map((job) => job.target))],
    summary = {
      images: Object.keys(images).length,
      files: files.length,
      bytes: (await Promise.all(files.map((file) => stat(file)))).reduce(
        (sum, row) => sum + row.size,
        0,
      ),
      decodedBytesPerPage24: 24 * 512 * 288 * 4,
    },
    manifest = { images, summary },
    target = path.join(dataRoot, "extras-previews.json"),
    bytes = Buffer.from(JSON.stringify(manifest) + "\n");
  if (!(await readFile(target).catch(() => Buffer.alloc(0))).equals(bytes))
    await writeFile(target, bytes);
  console.log(JSON.stringify({ previews: summary, ...cache }));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    at = args.indexOf("--data");
  await buildExtrasPreviews(at < 0 ? {} : { dataRoot: args[at + 1] });
}
