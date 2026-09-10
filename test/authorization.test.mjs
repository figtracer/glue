import test from "node:test";
import assert from "node:assert/strict";
import { authorize, checkGrant } from "../src/authorization.mjs";
import { initialState, policyHash } from "../src/worker.mjs";
const now = 1800000000000;
const config = {
  version: 2,
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
  chain: "base",
  token: "pathusd",
  belowEth: "0.00002",
  amount: "0.05",
  minReceiveEth: "0.000001",
  maxSpend: "0.15",
  feeReserve: "0.01",
  durationSeconds: 1800,
  intervalSeconds: 30,
  cooldownSeconds: 30,
};
function fixture() {
  const state = initialState(config);
  let grant,
    calls = 0,
    saved;
  const io = {
    now: () => now,
    describe: () => {},
    save: async (s) => {
      saved = structuredClone(s);
    },
    connect: async (approval) => {
      assert.equal(saved.authorization.phase, "pending");
      calls++;
      grant = {
        key: "0x3333333333333333333333333333333333333333",
        wallet: config.sender,
        chainId: 4217,
        expiry: approval.requestExpiry,
        limit: approval.limit,
        limited: true,
        period: 0,
        source: "tempo-signed-grant",
      };
    },
    authority: async () => {
      if (!grant) throw Error("No grant");
      return grant;
    },
  };
  return { state, io, calls: () => calls, grant: () => grant };
}
test("dedicated grant requests one Tempo expiry and remaining allowance; repeats do not renew", async () => {
  const f = fixture();
  f.state.spent = "50000";
  const preview = await authorize(config, f.state, f.io);
  assert.equal(preview.durationSeconds, 1800);
  assert.equal(preview.amount, "0.11");
  assert.equal(preview.payments, "0.1");
  assert.equal(preview.feeReserve, "0.01");
  assert.equal(f.state.authorization, undefined);
  await authorize(config, f.state, f.io, { approve: true });
  assert.equal(f.grant().expiry, now / 1000 + 1800);
  assert.equal(f.grant().limit, "110000");
  assert.equal(f.state.authorization.requestExpiry, undefined);
  assert.equal(f.state.authorization.expiresAt, undefined);
  await authorize(config, f.state, f.io, { approve: true });
  assert.equal(f.calls(), 1);
  assert.equal(f.state.spent, "50000");
});
test("restart recovers unique signed grant without repeating ceremony", async () => {
  const f = fixture();
  const connect = f.io.connect;
  f.io.connect = async (a) => {
    await connect(a);
    throw Error("crash");
  };
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /crash/);
  await authorize(config, f.state, f.io);
  assert.equal(f.calls(), 1);
  assert.equal(f.state.authorization.phase, "active");
});
test("cancelled approval with no signed grant never activates or retries", async () => {
  const f = fixture();
  f.io.connect = async () => {
    throw Error("cancelled");
  };
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /cancelled/);
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /No grant/);
  assert.equal(f.state.authorization.phase, "pending");
});
test("reject wrong wallet, key, network, broader limit, recurring authority and altered requested expiry", async () => {
  const f = fixture();
  await authorize(config, f.state, f.io, { approve: true });
  for (const patch of [
    { wallet: config.recipient },
    { key: config.recipient },
    { chainId: 1 },
    { limit: "200000" },
    { period: 1 },
    { revoked: true },
    { limited: false },
    { expiry: now / 1000 },
  ])
    assert.throws(() => checkGrant(config, f.state.authorization, { ...f.grant(), ...patch }, now));
  assert.throws(() =>
    checkGrant(
      config,
      {
        phase: "pending",
        policyHash: policyHash(config),
        requestExpiry: now / 1000 + 60,
        limit: "150000",
      },
      f.grant(),
      now,
    ),
  );
  // Runtime expiry comes from Tempo, never the original requested duration.
  assert.equal(
    checkGrant(config, f.state.authorization, { ...f.grant(), expiry: now / 1000 + 45 }, now),
    now + 45000,
  );
});
test("pending payments, exhausted budgets and failed persistence never open approval", async () => {
  const f = fixture();
  f.state.pending = { key: "glue-123", phase: "submitting" };
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /Reconcile/);
  f.state.pending = null;
  f.state.spent = "150000";
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /exhausted/);
  f.state.spent = "0";
  f.io.save = async () => {
    throw Error("disk full");
  };
  await assert.rejects(authorize(config, f.state, f.io, { approve: true }), /disk full/);
  assert.equal(f.calls(), 0);
});

test("existing grants keep their allowance; fresh grants require explicit fee headroom", async () => {
  const legacy = { ...config };
  delete legacy.feeReserve;
  const state = initialState(legacy);
  const f = fixture();
  await assert.rejects(authorize(legacy, state, f.io, { approve: true }), /fee-reserve/);
  assert.equal(state.authorization, undefined);
  assert.equal(f.calls(), 0);
  state.authorization = {
    phase: "active",
    policyHash: policyHash(legacy),
    limit: "150000",
    key: "0x3333333333333333333333333333333333333333",
  };
  f.io.authority = async () => ({
    key: state.authorization.key,
    wallet: legacy.sender,
    chainId: 4217,
    limited: true,
    limit: "148145",
    expiry: now / 1000 + 60,
    source: "tempo-chain",
  });
  await authorize(legacy, state, f.io, { approve: true });
  assert.equal(state.authorization.limit, "150000");
  assert.equal(f.calls(), 0);
});
