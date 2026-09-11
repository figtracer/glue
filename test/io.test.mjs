import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIO, inspectJob, atomicWrite } from "../src/io.mjs";
import { initialState, policyHash, tick, TOKENS } from "../src/worker.mjs";
import { Challenge } from "mppx";
import { checkChallenge, createWallet } from "../src/wallet.mjs";
const config = {
  version: 2,
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
  chain: "base",
  token: "pathusd",
  belowEth: "0.00001",
  amount: "0.05",
  minReceiveEth: "0.000001",
  maxSpend: "0.05",
  feeReserve: "0.01",
  durationSeconds: 1800,
  intervalSeconds: 30,
  cooldownSeconds: 30,
};
test("HTTP refill binds signing key, preserves credential, reconciles and spends once", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "glue-io-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const controller = new AbortController();
  let payments = 0,
    signatures = 0,
    remaining = "50000";
  const state = initialState(config),
    key = "0x3333333333333333333333333333333333333333";
  state.authorization = { phase: "active", key, policyHash: policyHash(config), limit: "60000" };
  await atomicWrite(join(dir, "state.json"), state);
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const x of req) raw += x;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/rpc")
      return res.end(JSON.stringify({ result: body.method === "eth_chainId" ? "0x2105" : "0x0" }));
    if (req.url === "/api/status") return res.end(JSON.stringify({ status: "success" }));
    if (req.headers.authorization) {
      assert.equal(req.headers.authorization, "Payment signed");
      payments++;
      controller.abort();
    }
    res.statusCode = payments ? 200 : 402;
    res.setHeader("WWW-Authenticate", "Payment test");
    res.end(
      JSON.stringify({
        orderId: req.headers["idempotency-key"],
        recipient: config.recipient,
        chainId: 8453,
        token: TOKENS.pathusd,
        amount: "0.05",
        paymentRecipient: config.sender,
        minimumEth: "0.00001",
        expiresAt: Date.now() + 60000,
        statusUrl: "/api/status",
      }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const api = `http://127.0.0.1:${server.address().port}`;
  const wallet = {
    authority: async (passed) => {
      assert.equal(passed, key);
      return {
        key,
        wallet: config.sender,
        chainId: 4217,
        expiry: Math.floor(Date.now() / 1000) + 1800,
        limited: true,
        limit: remaining,
      };
    },
    credential: async (p, _response, passed) => {
      assert.equal(passed, key);
      const saved = JSON.parse(await readFile(join(dir, "state.json")));
      assert.equal(saved.pending.phase, "submitting");
      signatures++;
      return "Payment signed";
    },
  };
  const io = createIO(config, dir, { api, rpc: api + "/rpc" }, wallet);
  assert.equal((await tick(config, state, io)).status, "quote");
  for (remaining of ["48145", "50000"]) {
    await assert.rejects(tick(config, state, io, { execute: true }), /plus network fees/);
    assert.equal(state.spent, "0");
    assert.equal(signatures, 0);
    assert.equal(payments, 0);
  }
  remaining = "60000";
  const cancellable = createIO(
    config,
    dir,
    { api, rpc: api + "/rpc", signal: controller.signal },
    wallet,
  );
  assert.equal((await tick(config, state, cancellable, { execute: true })).status, "submitted");
  assert.equal(controller.signal.aborted, true);
  assert.equal(
    JSON.parse(await readFile(join(dir, `${state.pending.key}.response.json`))).orderId,
    state.pending.key,
  );
  const saved = JSON.parse(await readFile(join(dir, "state.json")));
  assert.equal((await tick(config, saved, io)).status, "delivered");
  assert.equal((await tick(config, saved, io, { execute: true })).status, "budget_exhausted");
  assert.equal(payments, 1);
  assert.equal(signatures, 1);
});
test("MPP challenge rejects extra recipients, wrong token, amount and source chain", () => {
  const pending = { offer: { paymentRecipient: config.sender } },
    challenge = {
      method: "tempo",
      intent: "charge",
      request: {
        amount: "50000",
        currency: TOKENS.pathusd,
        recipient: config.sender,
        methodDetails: { chainId: 4217 },
      },
    };
  assert.doesNotThrow(() => checkChallenge(config, pending, challenge));
  for (const patch of [
    { amount: "100000" },
    { currency: TOKENS["usdc.e"] },
    { recipient: config.recipient },
    { methodDetails: { chainId: 1 } },
    { methodDetails: { chainId: 4217, splits: [{ recipient: config.recipient }] } },
  ])
    assert.throws(() =>
      checkChallenge(config, pending, {
        ...challenge,
        request: { ...challenge.request, ...patch },
      }),
    );
});

test("installed MPP SDK prepares and rejects a mismatched challenge before signing", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "glue-sdk-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const challenge = Challenge.from({
    id: "test",
    realm: "glue.example",
    method: "tempo",
    intent: "charge",
    request: {
      amount: "100000",
      currency: TOKENS.pathusd,
      recipient: config.sender,
      methodDetails: { chainId: 4217 },
    },
  });
  const response = new Response(null, {
    status: 402,
    headers: { "WWW-Authenticate": Challenge.serialize(challenge) },
  });
  await assert.rejects(
    createWallet(config, dir).credential(
      { offer: { paymentRecipient: config.sender } },
      response,
      config.sender,
    ),
    /MPP payment challenge differs/,
  );
});

test(
  "cancelling RPC, quote and receipt reads aborts without creating payment state",
  { timeout: 5000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "glue-cancel-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    let received;
    const server = createServer(() => received());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const api = `http://127.0.0.1:${server.address().port}`;
    for (const action of [
      (io) => io.balance(),
      (io) => io.order({ key: "test", body: {} }),
      (io) => io.receipt("/api/status"),
    ]) {
      const controller = new AbortController();
      const request = new Promise((resolve) => {
        received = resolve;
      });
      const io = createIO(config, dir, { api, rpc: api, signal: controller.signal });
      const result = action(io);
      const rejected = assert.rejects(result, { name: "AbortError" });
      await request;
      controller.abort();
      await rejected;
    }
    await assert.rejects(readFile(join(dir, "state.json")), { code: "ENOENT" });
  },
);

test("status preserves balance or authority when the other read fails", async () => {
  const state = { authorization: { phase: "active", key: "key" } };
  const grant = { expiry: 1, limit: "50000", source: "tempo-chain" };
  const io = {
    balance: async () => {
      throw new Error("RPC unavailable");
    },
    authority: async () => grant,
  };
  const result = await inspectJob(state, io);
  assert.equal(result.balance, null);
  assert.equal(result.authority.remainingSeconds, 0);
  assert.equal(result.authority.remaining, "50000");
  assert.deepEqual(result.errors, ["RPC unavailable"]);
  io.balance = async () => 123n;
  io.authority = async () => {
    throw new Error("Tempo unavailable");
  };
  const partial = await inspectJob(state, io);
  assert.equal(partial.balance, "123");
  assert.equal(partial.authority, null);
  assert.deepEqual(partial.errors, ["Tempo unavailable"]);
});
