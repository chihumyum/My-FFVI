import assert from "node:assert/strict";
import test from "node:test";
import { selectGamePackage } from "../src/core/game-package-selection.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

test("an empty title selects the initialized systems package without constructing a session", () => {
  for (const search of ["", "?"]) assert.deepEqual(selectGamePackage(search), {
    packageId: "systems-initialized", profile: "framework", explicitProfile: false, defaulted: true,
  });
});

test("explicit source, framework and map routes retain their previous package-free selection", () => {
  for (const search of ["?profile=source", "?map=3&entrance=1", "?unknown=value", "?profile=unknown"])
    assert.deepEqual(selectGamePackage(search), { packageId: null, profile: "source",
      explicitProfile: search.includes("profile="), defaulted: false });
  assert.deepEqual(selectGamePackage("?profile=framework&map=3"), {
    packageId: null, profile: "framework", explicitProfile: true, defaulted: false,
  });
});

test("explicit packages and profile assertions remain explicit, including the older playground", () => {
  for (const packageId of ["systems-initialized", "world-travel", "systems-playground", "custom-batch"])
    assert.deepEqual(selectGamePackage("?package=" + packageId), {
      packageId, profile: "source", explicitProfile: false, defaulted: false,
    });
  assert.deepEqual(selectGamePackage("?package=world-travel&profile=source"), {
    packageId: "world-travel", profile: "source", explicitProfile: true, defaulted: false,
  });
  assert.equal(selectGamePackage("?package=custom-batch&profile=framework").profile, "framework");
  assert.equal(selectGamePackage("?package=custom-batch&package=world-travel").packageId, "custom-batch");
});

test("invalid explicit package identities never fall back to the default entry or save namespace", () => {
  for (const packageId of ["", "../source", "/source", "UPPER", "a_b", "a".repeat(81)])
    assert.throws(() => selectGamePackage("?package=" + encodeURIComponent(packageId)), /Invalid content package identity/);
});

test("default and explicit systems entries share one slot while travel and original progress stay separate", async () => {
  const bytes = new Map<string, string>();
  const port = { getItem: (key: string) => bytes.get(key) ?? null,
    setItem: (key: string, value: string) => { bytes.set(key, value); } };
  // Real persistence, with the profile obtained from each trusted package's refs.
  const storage = (search: string, packageProfile?: "source" | "framework") => {
    const selection = selectGamePackage(search);
    return new CheckpointStorage(port, packageProfile ?? selection.profile, selection.packageId ?? undefined);
  };
  const checkpoint = checkpointFixture().game.checkpoint();
  await storage("").save(checkpoint, 100);
  assert.equal((await storage("?package=systems-initialized", "framework").load())!.savedAt, 100);
  assert.equal(await storage("?package=world-travel", "framework").load(), null);
  assert.equal(await storage("?profile=source").load(), null);
  await storage("?package=world-travel", "framework").save(checkpoint, 200);
  await storage("?profile=source").save(checkpoint, 300);
  assert.equal(bytes.size, 3);
  assert.equal((await storage("").load())!.savedAt, 100);
  assert.equal((await storage("?package=world-travel", "framework").load())!.savedAt, 200);
  assert.equal((await storage("?profile=source").load())!.savedAt, 300);
});
