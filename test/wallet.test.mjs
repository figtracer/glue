import test from "node:test";
import assert from "node:assert/strict";
import { serializeStorageWrites } from "../src/wallet.mjs";

test("wallet storage writes finish in order before flush returns", async () => {
  const started = [];
  const release = [];
  const storage = {
    setItem: async (key) => {
      started.push(key);
      await new Promise((resolve) => release.push(resolve));
    },
  };
  const flush = serializeStorageWrites(storage);
  const first = storage.setItem("account");
  const second = storage.setItem("grant");

  await Promise.resolve();
  assert.deepEqual(started, ["account"]);
  release.shift()();
  await first;
  assert.deepEqual(started, ["account", "grant"]);
  release.shift()();
  await second;
  await flush();
});
