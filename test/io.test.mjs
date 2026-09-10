import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createIO, atomicWrite } from "../src/io.mjs";
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
  durationSeconds: 1800,
  intervalSeconds: 30,
  cooldownSeconds: 30,
};
test("HTTP refill binds signing key, preserves credential, reconciles and spends once", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "glue-io-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let payments = 0,
    signatures = 0;
  const state = initialState(config),
    key = "0x3333333333333333333333333333333333333333";
  state.authorization = { phase: "active", key, policyHash: policyHash(config), limit: "50000" };
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
        limit: "50000",
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
  assert.equal((await tick(config, state, io, { execute: true })).status, "submitted");
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
