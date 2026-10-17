import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readSnapshot, snapshotFile } from "../src/compiler/integrity.js";

test("changed export and unlisted dependencies cannot enter a source-verified build", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ffvi-snapshot-"));
  try {
    const original = '{"id":"-9127841932506724402"}';
    await writeFile(join(dir, "graph.json"), original);
    await writeFile(join(dir, "snapshot.json"), JSON.stringify({ formatVersion: 1, files: [
      { file: "graph.json", sha256: createHash("sha256").update(original).digest("hex") },
    ] }));
    const snapshot = await readSnapshot(dir);
    assert.equal(snapshotFile(snapshot, "graph.json").toString(), original);
    assert.throws(() => snapshotFile(snapshot, "other.json"), /Unlisted/);
    await writeFile(join(dir, "graph.json"), '{"id":"0"}');
    assert.equal(snapshotFile(snapshot, "graph.json").toString(), original);
    await assert.rejects(readSnapshot(dir), /Snapshot changed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
