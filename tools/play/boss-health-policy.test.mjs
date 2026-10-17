import { test } from "node:test";
import assert from "node:assert/strict";
import { isHpRecovery } from "./boss-health-policy.mjs";

test("Boss statistics low-HP input never spends Ether on HP recovery", () => {
  const item = (id, values) => ({ id: `item:${id}`, functions: [{ id: 1, values }] });
  assert.equal(isHpRecovery(item(2, [1, 1, 0])), true);
  assert.equal(isHpRecovery(item(5, [1, 3, 0])), false);
  assert.equal(
    isHpRecovery({ id: 31, kind: "heal", functions: [{ id: 1, values: [0, 1, 0] }] }),
    true,
  );
  assert.equal(
    isHpRecovery({ id: 31, kind: "heal", revive: true, functions: [{ id: 1, values: [0, 1, 0] }] }),
    false,
  );
});
