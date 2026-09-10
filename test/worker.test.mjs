import test from "node:test";
import assert from "node:assert/strict";
import { tick, initialState, validate, units, TOKENS } from "../src/worker.mjs";
const now = Date.parse("2030-01-01T00:00:00Z");
const config = {
  version: 1,
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
  chain: "base",
  token: "pathusd",
  belowEth: "0.00002",
  amount: "0.25",
  minReceiveEth: "0.00001",
  maxSpend: "0.50",
  expiresAt: "2030-01-02T00:00:00Z",
  intervalSeconds: 60,
  cooldownSeconds: 300,
};
function fixture(c = config) {
  const state = initialState(c),
    calls = { pay: 0, quote: 0, saved: [] };
  let time = now;
  const io = {
    now: () => time,
    save: async (s) => {
      calls.saved.push(structuredClone(s));
    },
    balance: async () => 0n,
    verifyWallet: async () => now + 86400000,
    order: async (p) => {
      calls.quote++;
      return {
        status: 402,
        challenge: "Payment fake",
        body: {
          orderId: p.key,
          recipient: c.recipient,
          chainId: 8453,
          token: TOKENS[c.token],
          amount: c.amount,
          paymentRecipient: c.sender,
          minimumEth: "0.0001",
          expiresAt: time + 60_000,
        },
      };
    },
    receipt: async () => ({ status: "success" }),
    pay: async () => {
      calls.pay++;
    },
  };
  return {
    state,
    io,
    calls,
    advance: (ms) => {
      time += ms;
    },
  };
}
test("preview quotes pathUSD without submitting and reuses the unpaid order", async () => {
  const { state, io, calls } = fixture();
  assert.equal((await tick(config, state, io)).status, "quote");
  const key = state.pending.key;
  assert.equal(state.pending.body.token, TOKENS.pathusd);
  await tick(config, state, io);
  assert.equal(state.pending.key, key);
  assert.equal(calls.pay, 0);
  assert.equal(state.spent, "0");
});
test("funded wallet produces no quote or payment", async () => {
  const { state, io, calls } = fixture();
  io.balance = async () => units(config.belowEth, 18);
  assert.equal((await tick(config, state, io, { execute: true })).status, "funded");
  assert.equal(calls.quote, 0);
});
test("journal and budget precede payment; restart after ambiguous submission never charges again", async () => {
  const { state, io, calls } = fixture();
  io.pay = async () => {
    calls.pay++;
    assert.equal(calls.saved.at(-1).pending.phase, "submitting");
    assert.equal(calls.saved.at(-1).spent, "250000");
    throw new Error("connection lost");
  };
  await assert.rejects(tick(config, state, io, { execute: true }), /connection lost/);
  assert.equal(
    (await tick(config, structuredClone(calls.saved.at(-1)), io, { execute: true })).status,
    "payment_unknown",
  );
  assert.equal(calls.pay, 1);
});
test("reconciles after expiry without paying", async () => {
  const { state, io, calls, advance } = fixture();
  await tick(config, state, io, { execute: true });
  io.order = async (p) => ({
    status: 200,
    body: { orderId: p.key, status: "submitted", statusUrl: "/api/status?a=1" },
  });
  advance(86_400_001);
  assert.equal((await tick(config, state, io, { execute: true })).status, "delivered");
  assert.equal((await tick(config, state, io, { execute: true })).status, "expired");
  assert.equal(calls.pay, 1);
});
test("pending delivery suppresses new orders", async () => {
  const { state, io, calls } = fixture();
  await tick(config, state, io, { execute: true });
  io.order = async (p) => ({
    status: 202,
    body: { orderId: p.key, status: "payment_pending", statusUrl: "/api/status?a=1" },
  });
  io.receipt = async () => ({ status: "pending" });
  for (let i = 0; i < 3; i++)
    assert.equal((await tick(config, state, io, { execute: true })).status, "pending");
  assert.equal(calls.pay, 1);
});
test("total budget persists across deliveries, with USDC.e", async () => {
  const c = { ...config, token: "usdc.e", maxSpend: "0.25" };
  const { state, io, calls } = fixture(c);
  await tick(c, state, io, { execute: true });
  io.order = async (p) => ({
    status: 200,
    body: { orderId: p.key, status: "submitted", statusUrl: "/api/status" },
  });
  assert.equal((await tick(c, state, io, { execute: true })).status, "delivered");
  assert.equal((await tick(c, state, io, { execute: true })).status, "budget_exhausted");
  assert.equal(calls.pay, 1);
});
test("mismatched quote or insufficient minimum output cannot spend", async () => {
  for (const bad of [
    { recipient: config.sender },
    { token: TOKENS["usdc.e"] },
    { amount: "0.5" },
    { minimumEth: "0.0000001" },
    { chainId: 1 },
  ]) {
    const { state, io, calls } = fixture();
    const order = io.order;
    io.order = async (p) => {
      const q = await order(p);
      Object.assign(q.body, bad);
      return q;
    };
    await assert.rejects(tick(config, state, io, { execute: true }));
    assert.equal(calls.pay, 0);
  }
});
test("rechecks expiry and balance after quote", async () => {
  for (const mode of ["expiry", "balance"]) {
    const { state, io, calls, advance } = fixture();
    io.verifyWallet = async () => {
      if (mode === "expiry") advance(86_400_001);
      else io.balance = async () => units(config.belowEth, 18);
      return now + 86400000;
    };
    assert.equal(
      (await tick(config, state, io, { execute: true })).status,
      mode === "expiry" ? "expired" : "funded",
    );
    assert.equal(calls.pay, 0);
  }
});
test("policy edits cannot reset budget", async () => {
  const { state, io } = fixture();
  await assert.rejects(
    tick({ ...config, maxSpend: "100" }, state, io, { execute: true }),
    /Policy changed/,
  );
});
test("only a never-submitted quote can be replaced on expiry", async () => {
  const { state, io } = fixture();
  await tick(config, state, io);
  const first = state.pending.key,
    order = io.order;
  io.order = async (p) => (p.key === first ? { status: 410, body: {} } : order(p));
  await tick(config, state, io);
  assert.notEqual(state.pending.key, first);
});
test("refund pauses without recycling budget", async () => {
  const { state, io, calls } = fixture();
  await tick(config, state, io, { execute: true });
  io.order = async (p) => ({ status: 200, body: { orderId: p.key, status: "refunded" } });
  assert.equal((await tick(config, state, io, { execute: true })).status, "needs_attention");
  assert.equal(state.paused, true);
  assert.equal(state.spent, "250000");
  assert.equal(calls.pay, 1);
});
test("cooldown and pause suppress spending", async () => {
  const { state, io, calls } = fixture();
  state.lastDeliveredAt = now;
  assert.equal((await tick(config, state, io, { execute: true })).status, "cooldown");
  state.paused = true;
  assert.equal((await tick(config, state, io, { execute: true })).status, "paused");
  assert.equal(calls.pay, 0);
});
test("decimal arithmetic and strict policy input", () => {
  assert.equal(units("0.000000000000000001", 18), 1n);
  for (const value of ["1e-6", "-1", "NaN", "0.0000001", 0.25])
    assert.throws(() => units(value, 6));
  assert.throws(() => validate({ ...config, typo: true }));
  assert.throws(() => validate({ ...config, amount: "0" }));
});
