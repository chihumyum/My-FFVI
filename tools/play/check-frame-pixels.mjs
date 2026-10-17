// Inspect the selected packed texture, independently of the renderer's
// "drawn" flag. This does not prove screen visibility after masks/occlusion.
export async function inspectFramePixels(page, frames) {
  const resources = [
    ...new Set(frames.filter((row) => row.drawn && row.resource).map((row) => row.resource)),
  ];
  return page.evaluate(async (resources) => {
    const base = new URL("./", location.href),
      index = await (await fetch(new URL("data/index.json", base))).json(),
      pages = new Map(),
      results = [];
    for (const resource of resources) {
      const entry = index.assets.images[resource];
      if (!entry) {
        results.push({ resource, error: "selected texture is not indexed" });
        continue;
      }
      if (!pages.has(entry.file))
        pages.set(
          entry.file,
          fetch(new URL(entry.file, base))
            .then((response) => response.blob())
            .then((blob) => createImageBitmap(blob)),
        );
      const image = await pages.get(entry.file),
        rect = entry.frame,
        canvas = document.createElement("canvas");
      canvas.width = rect?.w || image.width;
      canvas.height = rect?.h || image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(
        image,
        rect?.x || 0,
        rect?.y || 0,
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonzeroPixels = 0,
        alphaMax = 0;
      for (let at = 3; at < pixels.length; at += 4) {
        if (pixels[at]) nonzeroPixels++;
        alphaMax = Math.max(alphaMax, pixels[at]);
      }
      results.push({
        resource,
        width: canvas.width,
        height: canvas.height,
        alphaMax,
        nonzeroPixels,
        ...(nonzeroPixels ? {} : { issue: "selected-texture-fully-transparent" }),
      });
    }
    for (const promise of pages.values()) (await promise).close();
    return results;
  }, resources);
}
