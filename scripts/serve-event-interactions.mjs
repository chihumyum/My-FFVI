// Optional rendered-browser lane. Start the regular local server on 4173 first;
// run check-event-interactions-ui.mjs to generate the ignored fixture bundle.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = new Map([
  ["/", ["scripts/browser/event-interactions.html", "text/html; charset=utf-8"]],
  ["/interaction-check.js", ["scripts/browser/event-interactions.js", "text/javascript; charset=utf-8"]],
  ["/interaction-field.json", ["build/reports/event-interaction-ui-field.json", "application/json"]],
]);
const server = http.createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
  try {
    const url = new URL(request.url, "http://127.0.0.1:4174"), file = files.get(url.pathname);
    if (file) {
      const body = await readFile(root + file[0]);
      response.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : body); return;
    }
    const upstream = await fetch(`http://127.0.0.1:4173${url.pathname}${url.search}`, { method: request.method });
    response.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : Buffer.from(await upstream.arrayBuffer()));
  } catch (error) { response.writeHead(500).end(String(error)); }
});
server.listen(4174, "127.0.0.1", () => console.log("Controlled event interaction check: http://127.0.0.1:4174/"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
