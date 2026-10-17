import test from "node:test";
import assert from "node:assert/strict";
import { bindSystemMessages } from "../src/compiler/system-messages.js";
import { hash } from "../src/compiler/content.js";

function fixture() {
  const sources = [{ file: "Assets/message.bundle", sha256: "a".repeat(64), bytes: 123 }];
  return { formatVersion: 1, adapterVersion: "field-0.1.1", parentSourceSetHash: "parent",
    sources, sourceSetHash: hash(sources), messages: { system_zhc: { SYN_ITEM: "Synthetic item" } },
    messageSources: [{ file: "message.bundle", assetPath: "Assets/Message/system_zhc.txt", objectId: "9223372036854775807" }] };
}

test("shared system text retains bundle/object identity and rejects foreign, missing and rounded provenance", () => {
  const data = fixture();
  const result = bindSystemMessages(data, "parent", data.sources);
  assert.equal(result.messages.SYN_ITEM, "Synthetic item");
  assert.equal(result.source.objectId, "9223372036854775807");
  assert.equal(result.source.sha256, data.sources[0]!.sha256);
  assert.throws(() => bindSystemMessages(data, "other", data.sources), /manifest/);
  assert.throws(() => bindSystemMessages(data, "parent", []), /Foreign/);
  assert.throws(() => bindSystemMessages({ ...data, messageSources: [] }, "parent", data.sources), /object/);
  assert.throws(() => bindSystemMessages({ ...data, messageSources: [...data.messageSources, ...data.messageSources] }, "parent", data.sources), /ambiguous/);
  assert.throws(() => bindSystemMessages({ ...data, messageSources: [{ ...data.messageSources[0], objectId: Number.MAX_SAFE_INTEGER + 2 }] }, "parent", data.sources), /identity/);
});
