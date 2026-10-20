import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StoryStore } from "./story-store.mjs";
import { createStoryProject } from "../../src/play/story-demo.js";
test("source script IDs with underscores survive file save, listing and reload", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ffvi-story-source-"));
  try {
    const store = new StoryStore(directory),
      program = { name: "akto_halt", ops: [["Exit", [], [], []]] },
      document = {
        id: "source-akto-akto_halt",
        mode: "source",
        title: "阿克托",
        source: { program },
        program: structuredClone(program),
      };
    await store.save(document.id, document, 0);
    assert.equal((await store.list())[0].id, document.id);
    assert.deepEqual((await store.read(document.id)).document.program, program);
    assert.throws(() => store.file("../outside"), /无效/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("concurrent editor saves retain the accepted document, stale draft, and every revision", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ffvi-story-store-"));
  try {
    const store = new StoryStore(directory),
      project = createStoryProject();
    await store.save(project.id, project, 0);
    const a = structuredClone(project),
      b = structuredClone(project);
    a.title = "A";
    b.title = "B";
    const [accepted, conflict] = await Promise.all([
      store.save(project.id, a, 1),
      store.save(project.id, b, 1),
    ]);
    assert.equal(accepted.revision, 2);
    assert.equal(conflict.conflict, true);
    assert.equal((await store.read(project.id)).document.title, "A");
    assert.equal((await store.version(project.id, conflict.preserved)).document.title, "B");
    assert.equal((await store.version(project.id, "00000001.json")).document.title, project.title);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
