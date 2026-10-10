import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    let base, relative;
    if (url.pathname === '/reports/status.json') { base = resolve(root, 'build/reports'); relative = 'status.json'; }
    else if (url.pathname.startsWith('/imports/textures/')) { base = resolve(root, 'build/import/textures'); relative = decodeURIComponent(url.pathname.slice('/imports/textures/'.length)); }
    else { base = resolve(root, 'apps/workbench'); relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); }
    const file = resolve(base, relative);
    if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end('Not found; run the import and npm run pipeline first.'); }
});
server.listen(4173, '127.0.0.1', () => console.log('FFVI Reweb inspection workbench: http://127.0.0.1:4173'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
