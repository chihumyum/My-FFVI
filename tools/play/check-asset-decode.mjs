import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, webkit } from "playwright";

const engine = process.env.PLAY_BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const output = path.resolve(
  process.env.PLAY_DECODE_REPORT || `build/play/acceptance/step-2/image-decode-${engine}.json`,
);
const browser = await { chromium, webkit }[engine].launch({
  headless: true,
  args: engine === "chromium" && process.platform === "darwin" ? ["--use-angle=metal"] : [],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.PLAY_WEB_URL || "http://127.0.0.1:4174/");
  const result = await page.evaluate(async () => {
    const response = await fetch(new URL("data/index.json", location.href));
    if (!response.ok) throw Error(`Index HTTP ${response.status}`);
    const index = await response.json(),
      pages = new Map();
    for (const [resource, entry] of Object.entries(index.assets.images)) {
      if (!pages.has(entry.file)) pages.set(entry.file, []);
      pages.get(entry.file).push({ resource, frame: entry.frame });
    }
    const pending = [...pages],
      results = [];
    const work = async () => {
      for (let job; (job = pending.shift());) {
        const [file, frames] = job;
        let image;
        try {
          const response = await fetch(new URL(file, location.href));
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          const bytes = await response.blob();
          // Full browser PNG decoding, rather than trusting its header. The
          // decoded bitmap is released before processing the next image page.
          image = await createImageBitmap(bytes);
          if (!image.width || !image.height) throw Error("Empty decoded image");
          for (const { frame } of frames)
            if (
              !frame ||
              frame.x < 0 ||
              frame.y < 0 ||
              frame.w <= 0 ||
              frame.h <= 0 ||
              frame.x + frame.w > image.width ||
              frame.y + frame.h > image.height
            )
              throw Error("Atlas frame exceeds the decoded page");
          results.push({ file, bytes: bytes.size, width: image.width, height: image.height });
        } catch (error) {
          results.push({
            file,
            error: error.message,
            resources: frames.map((row) => row.resource),
          });
        } finally {
          image?.close();
        }
      }
    };
    await Promise.all([work(), work()]);
    results.sort((a, b) => a.file.localeCompare(b.file));
    return {
      pageURL: location.href,
      images: Object.keys(index.assets.images).length,
      pages: pages.size,
      bytes: results.reduce((sum, row) => sum + (row.bytes || 0), 0),
      failures: results.filter((row) => row.error),
      results,
    };
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        engine,
        scope:
          "Every indexed PNG page fetched and fully decoded in a real browser; this does not verify scene composition or appearance.",
        ...result,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      engine,
      pages: result.pages,
      images: result.images,
      failures: result.failures.length,
      errors,
    }),
  );
  assert.deepEqual(result.failures, []);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
