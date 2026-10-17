import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(import.meta.dirname, "..");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".flac": "audio/flac",
};
const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const url = new URL(req.url, "http://127.0.0.1");
    let base, relative;
    if (url.pathname === "/reports/status.json") {
      base = resolve(root, "build/reports");
      relative = "status.json";
    } else if (url.pathname === "/game/content.json") {
      base = resolve(root, "build/game");
      relative = "narshe.json";
    } else if (url.pathname === "/game/battle.json") {
      base = resolve(root, "build/game");
      relative = "opening-playable.json";
    } else if (url.pathname === "/game/new-game.json") {
      base = resolve(root, "build/game");
      relative = "source-new-game.json";
    } else if (url.pathname === "/game/source-catalog.json") {
      base = resolve(root, "build/game");
      relative = "source-catalog.json";
    } else if (url.pathname.startsWith("/content-packages/")) {
      base = resolve(root, "build/content-packages");
      relative = decodeURIComponent(url.pathname.slice("/content-packages/".length));
    } else if (url.pathname.startsWith("/content-releases/")) {
      base = resolve(root, "build/content-releases");
      relative = decodeURIComponent(url.pathname.slice("/content-releases/".length));
    } else if (url.pathname.startsWith("/framework/")) {
      base = resolve(root, "build/framework");
      relative = decodeURIComponent(url.pathname.slice("/framework/".length));
    } else if (url.pathname.startsWith("/field-skybox-media/")) {
      base=resolve(root,"build/field-skybox-media");relative=decodeURIComponent(url.pathname.slice("/field-skybox-media/".length));
    } else if (url.pathname.startsWith("/field-background-media/")) {
      base = resolve(root, "build/field-background-media");
      relative = decodeURIComponent(url.pathname.slice("/field-background-media/".length));
    } else if (url.pathname === "/world/catalog.json") {
      base = resolve(root, "build/world");
      relative = "catalog.json";
    } else if (url.pathname.startsWith("/world/maps/")) {
      base = resolve(root, "build/world/maps");
      relative = decodeURIComponent(url.pathname.slice("/world/maps/".length));
    } else if (url.pathname.startsWith("/world-media/")) {
      base = resolve(root, "build/world-media");
      relative = decodeURIComponent(url.pathname.slice("/world-media/".length));
    } else if (url.pathname.startsWith("/map-ui/")) {
      base = resolve(root, "build/map-ui");
      relative = decodeURIComponent(url.pathname.slice("/map-ui/".length));
    } else if (url.pathname.startsWith("/bgm/tracks/")) {
      base = resolve(root, "build/bgm/tracks");
      relative = decodeURIComponent(url.pathname.slice("/bgm/tracks/".length));
    } else if (url.pathname.startsWith("/se/tracks/")) {
      base = resolve(root, "build/se/tracks");
      relative = decodeURIComponent(url.pathname.slice("/se/tracks/".length));
    } else if (url.pathname.startsWith("/environment/tracks/")) {
      base = resolve(root, "build/environment/tracks");
      relative = decodeURIComponent(
        url.pathname.slice("/environment/tracks/".length),
      );
    } else if (url.pathname.startsWith("/battle/sprites/")) {
      base = resolve(root, "build/battle/sprites");
      relative = decodeURIComponent(
        url.pathname.slice("/battle/sprites/".length),
      );
    } else if (url.pathname.startsWith("/game/")) {
      base = resolve(root, "apps/game");
      relative = decodeURIComponent(url.pathname.slice(6)) || "index.html";
    } else if (url.pathname.startsWith("/runtime/core/")) {
      base = resolve(root, "dist/src/core");
      relative = decodeURIComponent(
        url.pathname.slice("/runtime/core/".length),
      );
    } else if (url.pathname.startsWith("/field/sprites/")) {
      base = resolve(root, "build/field/sprites");
      relative = decodeURIComponent(
        url.pathname.slice("/field/sprites/".length),
      );
    } else if (url.pathname.startsWith("/imports/textures/")) {
      base = resolve(root, "build/import/textures");
      relative = decodeURIComponent(
        url.pathname.slice("/imports/textures/".length),
      );
    } else {
      base = resolve(root, "apps/workbench");
      relative =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname.slice(1));
    }
    const file = resolve(base, relative);
    if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res
      .writeHead(404)
      .end("Not found; run the import and npm run pipeline first.");
  }
});
server.listen(4173, "127.0.0.1", () =>
  console.log("FFVI Web game: http://127.0.0.1:4173/game/ (workbench: /)"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
