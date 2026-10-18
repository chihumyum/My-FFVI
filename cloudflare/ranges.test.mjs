import test from "node:test";
import assert from "node:assert/strict";
import { rangeResponse } from "./ranges.mjs";

test("Asset byte ranges preserve bounds, suffixes, validators and unsatisfiable errors", async () => {
  const bytes = Uint8Array.from({ length: 100 }, (_, i) => i);
  for (const [range, status, from, to] of [
    ["bytes=0-15", 206, 0, 16],
    ["bytes=90-", 206, 90, 100],
    ["bytes=-5", 206, 95, 100],
    ["bytes=90-900", 206, 90, 100],
    ["bytes=100-", 416],
    ["bytes=-0", 416],
    ["bytes=10-2", 416],
    ["bytes=", 416],
  ]) {
    const source = new Response(bytes, { headers: { "Content-Length": "100", ETag: '"test"' } });
    const request = new Request("https://example.invalid/music.opus", {
      headers: { Range: range },
    });
    const result = await rangeResponse(source, request);
    assert.equal(result.status, status, range);
    if (status === 206)
      assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes.subarray(from, to));
  }
  const source = new Response(bytes, { headers: { "Content-Length": "100", ETag: '"new"' } });
  const result = await rangeResponse(
    source,
    new Request("https://example.invalid/a", {
      headers: { Range: "bytes=0-1", "If-Range": '"old"' },
    }),
  );
  assert.equal(result.status, 200);
  const withoutLength = await rangeResponse(
    new Response(bytes),
    new Request("https://example.invalid/music.opus", { headers: { Range: "bytes=0-15" } }),
    100,
  );
  assert.equal(withoutLength.status, 206);
  assert.equal((await withoutLength.arrayBuffer()).byteLength, 16);
});
