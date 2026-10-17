import { defineConfig } from "vite";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createBugReportMiddleware } from "./tools/play/bug-report-store.mjs";
const root = import.meta.dirname;
export default defineConfig({
  root: path.join(root, "apps/play"),
  base: "./",
  publicDir: path.join(root, "build/web-data/web"),
  server: { host: "127.0.0.1", port: 4173, strictPort: true, fs: { allow: [root] } },
  build: {
    outDir: path.join(root, "dist/web"),
    emptyOutDir: true,
    target: "es2022",
    manifest: true,
    rolldownOptions: {
      input: {
        game: path.join(root, "apps/play/index.html"),
        battle: path.join(root, "apps/play/battle-lab.html"),
        audio: path.join(root, "apps/play/audio-lab.html"),
      },
    },
  },
  plugins: [
    {
      name: "local-evidence-only",
      configureServer(server) {
        server.middlewares.use(
          createBugReportMiddleware({ directory: path.join(root, "bug-reports") }),
        );
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, "http://localhost");
          if (url.pathname.startsWith("/game/")) {
            req.url = req.url.replace(/^\/game\//, "/");
            return next();
          }
          const base = url.pathname.startsWith("/evidence/")
            ? "build/play"
            : url.pathname.startsWith("/play-data/")
              ? "build/web-data"
              : null;
          if (!base) return next();
          const relative = decodeURIComponent(url.pathname.slice(base === "build/play" ? 10 : 11));
          const directory = path.resolve(root, base),
            file = path.resolve(directory, relative);
          if (!file.startsWith(directory + path.sep)) {
            res.statusCode = 400;
            return res.end();
          }
          try {
            const bytes = await readFile(file);
            res.setHeader(
              "Content-Type",
              file.endsWith(".json")
                ? "application/json"
                : file.endsWith(".js")
                  ? "text/javascript"
                  : "application/octet-stream",
            );
            res.end(bytes);
          } catch {
            res.statusCode = 404;
            res.end("Missing local evidence");
          }
        });
      },
    },
  ],
});
