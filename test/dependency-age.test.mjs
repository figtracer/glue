import test from "node:test";
import assert from "node:assert/strict";
import { requireMature } from "../scripts/check-dependency-age.mjs";
test("dependency soak rejects unknown/future dates and permits exactly seven days", () => {
  const now = Date.parse("2026-09-10T00:00:00Z");
  for (const time of [undefined, "bad", "2026-09-11T00:00:00Z", "2026-09-03T00:00:01Z"])
    assert.throws(() => requireMature("package", time, now));
  assert.doesNotThrow(() => requireMature("package", "2026-09-03T00:00:00Z", now));
});
