import test from "node:test";
import assert from "node:assert/strict";
import { assertPrivatePackage } from "./package-safety.mjs";
test("distribution excludes live saves, passwords and deployment secrets at every depth", () => {
  for (const file of [
    "private-data/first-login.txt",
    "server/private-data/owner.json",
    ".env",
    ".env.local",
    "backups/save.sqlite",
    "nested/saves.sqlite-wal",
    "first-login.txt",
    "owner.json",
    "bug-reports/screenshot.png",
    "../owner.json",
    "/data/saves.sqlite",
  ]) {
    assert.throws(() => assertPrivatePackage([{ file }]));
  }
  assert.doesNotThrow(() =>
    assertPrivatePackage(
      [
        ".env.example",
        ".dockerignore",
        "web/.vite/manifest.json",
        "server/host.mjs",
        "web/data/map-1.json",
        "web/audio/hash.opus",
      ].map((file) => ({ file })),
    ),
  );
});
