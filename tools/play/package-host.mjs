import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import { assertPrivatePackage } from "./package-safety.mjs";
const root = path.resolve(import.meta.dirname, "../..");
const { values } = parseArgs({ options: { web: { type: "string" } } });
const web = path.resolve(values.web || "dist/private-web");
if (!values.web) {
  process.env.PLAY_BUNDLE_OUT = web;
  await import("./bundle.mjs");
}
await stat(path.join(web, "data/index.json"));
const output = path.join(root, "dist/private-host");
await mkdir(path.join(root, "dist"), { recursive: true });
const staging = await mkdtemp(path.join(root, "dist/.host-package-"));
const packageRoot = path.join(staging, "private-host");
try {
  await mkdir(packageRoot);
  await cp(web, path.join(packageRoot, "web"), { recursive: true });
  await cp(path.join(root, "server"), path.join(packageRoot, "server"), {
    recursive: true,
    filter: (file) => !file.endsWith(".test.mjs"),
  });
  for (const file of ["Dockerfile", "compose.yaml", "Caddyfile", ".env.example", ".dockerignore"])
    await cp(path.join(root, "deploy", file), path.join(packageRoot, file));
  await cp(path.join(root, "README.md"), path.join(packageRoot, "README.md"));
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify(
      {
        name: "ffvi-private-host",
        version: "1.0.0",
        private: true,
        type: "module",
        engines: { node: ">=24.4" },
        scripts: {
          start: "node server/cli.mjs --static web",
          backup: "node server/cli.mjs backup",
          verify: "node server/verify-package.mjs",
        },
      },
      null,
      2,
    ) + "\n",
  );
  const files = [];
  async function inventory(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = prefix + entry.name,
        full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error(`Distribution cannot contain symlinks: ${file}`);
      if (entry.isDirectory()) await inventory(full, file + "/");
      else
        files.push({
          file,
          bytes: (await stat(full)).size,
          sha256: createHash("sha256")
            .update(await readFile(full))
            .digest("hex"),
        });
    }
  }
  await inventory(packageRoot);
  assertPrivatePackage(files);
  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    note: "Private, authenticated resource distribution. No credentials, saves, raw PR installation or development evidence included. Source commit excludes any uncommitted local edits; acceptance records the final source state separately.",
    totalBytes: files.reduce((sum, row) => sum + row.bytes, 0),
    files,
  };
  await writeFile(
    path.join(packageRoot, "package-manifest.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  const archive = path.join(root, "dist/ffvi-private-host.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", staging, "private-host"], {
    stdio: "inherit",
  });
  // Update generated files only. Never remove the live private-data, .env or
  // backups, and never archive from a directory that may contain player data.
  await mkdir(output, { recursive: true });
  await cp(packageRoot, output, { recursive: true, force: true });
  await mkdir(path.join(root, "build/play/deployment"), { recursive: true });
  await writeFile(
    path.join(root, "build/play/deployment/package.json"),
    JSON.stringify(
      { ...report, files: undefined, output, archive, archiveBytes: (await stat(archive)).size },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      output,
      archive,
      bytes: report.totalBytes,
      archiveBytes: (await stat(archive)).size,
    }),
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
