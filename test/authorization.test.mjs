import test from "node:test";
import assert from "node:assert/strict";
import { authorize, checkAuthorization } from "../src/authorization.mjs";
import { initialState, TOKENS } from "../src/worker.mjs";
const now = Date.now();
const config = {
  version: 1,
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
  chain: "base",
  token: "pathusd",
  belowEth: "0.00002",
  amount: "0.05",
  minReceiveEth: "0.000001",
  maxSpend: "0.15",
  expiresAt: new Date(now + 600000).toISOString(),
  intervalSeconds: 30,
  cooldownSeconds: 30,
};
function fixture() {
  const state = initialState(config);
  const wallet = {
    ready: true,
    wallet: config.sender,
    key: {
      address: "0x3333333333333333333333333333333333333333",
      wallet_address: config.sender,
      chain_id: 4217,
      status: "ready",
      expires_at: new Date(now + 300000).toISOString(),
      spending_limits: [],
    },
  };
  let calls = 0,
    saved;
  const io = {
    now: () => now,
    wallet: async () => wallet,
    describe: () => {},
    save: async (s) => {
      saved = structuredClone(s);
    },
    approveKey: async (key, token, limit) => {
      assert.equal(saved.authorization.phase, "pending");
      assert.equal(key, wallet.key.address);
      calls++;
      wallet.key.spending_limits = [
        { token, limit, unlimited: false, period_seconds: null, remaining: null },
      ];
    },
  };
  return { state, wallet, io, calls: () => calls };
}
test("approval previews without writing, subtracts spent, and never refreshes on repetition", async () => {
  const f = fixture();
  f.state.spent = "50000";
  assert.equal((await authorize(config, f.state, f.io)).limit, "0.100000");
  assert.equal(f.state.authorization, undefined);
  assert.equal(f.calls(), 0);
  await authorize(config, f.state, f.io, { approve: true });
  assert.equal(f.state.spent, "50000");
  assert.equal(f.state.authorization.expiresAt, now + 300000);
  await authorize(config, f.state, f.io, { approve: true });
  assert.equal(f.calls(), 1);
});
test("cancelled or uncertain approval remains unresolved even if key data matches", async () => {
  const f = fixture();
  const approve = f.io.approveKey;
  f.io.approveKey = async (...args) => {
    await approve(...args);
    throw Error("cancelled");
  };
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /cancelled/);
  assert.equal(f.state.authorization.phase, "pending");
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /unresolved/);
  assert.equal(f.calls(), 1);
});
test("successful update resumes verification after read failure without resubmission", async () => {
  const f = fixture();
  const wallet = f.io.wallet;
  let reads = 0;
  f.io.wallet = async () => {
    if (++reads === 2) throw Error("offline");
    return wallet();
  };
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /offline/);
  assert.equal(f.state.authorization.phase, "update_returned");
  await authorize(config, f.state, f.io);
  assert.equal(f.state.authorization.phase, "active");
  assert.equal(f.calls(), 1);
});
test("reject missing or broader authority, switched key, network and expired allowance", async () => {
  const f = fixture();
  await authorize(config, f.state, f.io, { approve: true });
  for (const mutate of [
    (w) => (w.key.spending_limits = []),
    (w) => (w.key.spending_limits[0].unlimited = true),
    (w) => (w.key.spending_limits[0].limit = "1"),
    (w) => (w.key.spending_limits[0].period_seconds = 60),
    (w) => (w.key.address = config.recipient),
    (w) => (w.key.chain_id = 42431),
    (w) => (w.key.expires_at = new Date(now - 1).toISOString()),
    (w) => (w.ready = false),
  ]) {
    const w = structuredClone(f.wallet);
    mutate(w);
    assert.throws(() => checkAuthorization(config, f.state.authorization, w, now));
  }
  f.wallet.key.expires_at = new Date(now + 1000).toISOString();
  assert.equal(checkAuthorization(config, f.state.authorization, f.wallet, now), now + 1000);
  assert.throws(() => checkAuthorization(config, f.state.authorization, f.wallet, now + 1000));
});
test("never opens approval for pending payments, changed policy, exhausted budget or failed persistence", async () => {
  const f = fixture();
  f.state.pending = { key: "glue-123", phase: "submitting" };
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /Reconcile/);
  f.state.pending = null;
  f.state.spent = "150000";
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /exhausted/);
  f.state.spent = "0";
  await assert.rejects(
    authorize({ ...config, amount: "0.06" }, f.state, f.io, { approve: true }),
    /Policy changed/,
  );
  f.io.save = async () => {
    throw Error("disk full");
  };
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /disk full/);
  assert.equal(f.calls(), 0);
});
test("both source token allowances use the exact policy token", async () => {
  const f = fixture(),
    c = { ...config, token: "usdc.e" };
  f.state = initialState(c);
  await authorize(c, f.state, f.io, { approve: true });
  assert.equal(f.wallet.key.spending_limits[0].token, TOKENS["usdc.e"]);
});
