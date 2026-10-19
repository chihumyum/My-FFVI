import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_REPORT_BYTES, validateSubmittedReport } from "../../server/report-schema.mjs";

// A separate in-memory admin session avoids changing the browser's playing identity.
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
if (!option("--site") || !option("--password-file")) {
  console.error(
    "Usage: node tools/play/download-reports.mjs --site https://game.example --password-file /private/admin-password.txt [--directory bug-reports/cloud]",
  );
  process.exitCode = 1;
} else {
  const site = new URL(option("--site"));
  if (site.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(site.hostname))
    throw Error("Admin login requires HTTPS");
  if (site.username || site.password || site.search || site.hash || site.pathname !== "/")
    throw Error("Supply only the site's origin");
  const password = (await readFile(option("--password-file"), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!password) throw Error("Administrator password file is empty");
  const output = path.resolve(option("--directory") || "bug-reports/cloud");
  let cookie;
  async function request(route, input) {
    const response = await fetch(new URL(route, site), {
      method: input ? "POST" : "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        Origin: site.origin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    if (!response.ok)
      throw Error(`Report request failed (${response.status}); credentials have not been logged`);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_REPORT_BYTES) {
        await reader.cancel();
        throw Error("Oversized report response");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      value: JSON.parse(new TextDecoder().decode(bytes)),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  let downloaded = 0,
    skipped = 0;
  try {
    const login = await request("/api/session", { password });
    if (!login.value.legacy || !login.cookie) throw Error("Administrator login required");
    cookie = login.cookie;
    await mkdir(output, { recursive: true });
    for (let offset = 0; offset !== null;) {
      const { value: page } = await request(`/api/admin/reports?offset=${offset}`);
      for (const item of page.reports) {
        if (!/^[a-f0-9-]{36}$/.test(item.id)) throw Error("Unexpected report identifier");
        const folder = path.join(output, item.id);
        try {
          await readFile(path.join(folder, "report.json"));
          skipped++;
          continue;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        const { value } = await request(`/api/admin/reports/${item.id}`);
        const report = validateSubmittedReport(value);
        await mkdir(folder, { recursive: true });
        await writeFile(
          path.join(folder, "screenshot.png"),
          Buffer.from(report.screenshot.dataURL.split(",")[1], "base64"),
        );
        await writeFile(path.join(folder, "report.json"), JSON.stringify(report, null, 2) + "\n", {
          flag: "wx",
        });
        downloaded++;
      }
      offset = page.nextOffset;
    }
    console.log(JSON.stringify({ directory: output, downloaded, skipped }));
  } finally {
    if (cookie) await request("/api/logout", {}).catch(() => {});
  }
}
