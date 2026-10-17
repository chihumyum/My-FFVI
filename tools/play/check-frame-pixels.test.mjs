import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { inspectFramePixels } from "./check-frame-pixels.mjs";

test("a successfully loaded atlas sprite with zero alpha never counts as visible pixels", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 1;
      canvas.getContext("2d").fillRect(0, 0, 1, 1);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.route("http://ffvi-test.invalid/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/atlas.png")
        return route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") });
      if (pathname === "/data/index.json")
        return route.fulfill({
          json: {
            assets: {
              images: {
                visible: { file: "atlas.png", frame: { x: 0, y: 0, w: 1, h: 1 } },
                blank: { file: "atlas.png", frame: { x: 1, y: 0, w: 1, h: 1 } },
              },
            },
          },
        });
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Pixel inspection fixture</title>",
      });
    });
    await page.goto("http://ffvi-test.invalid/");
    const rows = await inspectFramePixels(page, [
      { drawn: true, resource: "visible" },
      { drawn: true, resource: "blank" },
    ]);
    assert.equal(rows[0].nonzeroPixels, 1);
    assert.equal(rows[0].issue, undefined);
    assert.equal(rows[1].nonzeroPixels, 0);
    assert.equal(rows[1].issue, "selected-texture-fully-transparent");
  } finally {
    await browser.close();
  }
});
