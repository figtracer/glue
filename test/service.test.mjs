import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serviceCommand, serviceTick } from "../src/service.mjs";
import { atomicWrite, loadState } from "../src/io.mjs";
import { TOKENS } from "../src/worker.mjs";

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
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "glue-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "service"),
    stateDir = join(root, "state"),
    policy = join(root, "policy.json");
  await atomicWrite(policy, config);
  let running = false,
    approved = 0,
    paid = 0,
    balance = 30000000000000n,
    expiry = 0;
  const scheduler = {
    files: [],
    manager: "test",
    loaded: async () => running,
    start: async () => {
      running = true;
    },
    stop: async () => {
      running = false;
    },
    remove: async () => {},
  };
  const grant = () => ({
    key: "0x3333333333333333333333333333333333333333",
    wallet: config.sender,
    chainId: 4217,
    expiry,
    limited: true,
    limit: "160000",
    source: "tempo-chain",
  });
  const io = {
    now: () => Date.now(),
    describe: () => {},
    save: (state) => atomicWrite(join(stateDir, "state.json"), state),
    connect: async (approval) => {
      approved++;
      expiry = approval.requestExpiry;
    },
    authority: async () => grant(),
    verifyWallet: async () => {
      if (expiry <= Date.now() / 1000) throw new Error("Tempo grant expired; approval required.");
      return expiry * 1000;
    },
    balance: async () => balance,
    order: async (pending) => ({
      status: paid ? 200 : 402,
      challenge: "Payment mock",
      body: {
        orderId: pending.key,
        recipient: config.recipient,
        chainId: 8453,
        token: TOKENS.pathusd,
        amount: config.amount,
        paymentRecipient: config.sender,
        minimumEth: "0.00001",
        expiresAt: Date.now() + 60000,
        statusUrl: "/api/status",
      },
    }),
    pay: async () => {
      paid++;
    },
    receipt: async () => ({ status: "success" }),
  };
  const deps = { directory, scheduler, ioFactory: () => io };
  const options = { policy, "state-dir": stateDir, "accept-network-fees": true };
  return {
    directory,
    stateDir,
    policy,
    deps,
    options,
    io,
    grant,
    approved: () => approved,
    paid: () => paid,
    running: () => running,
    balance: (value) => {
      balance = value;
    },
    expire: () => {
      expiry = Math.floor(Date.now() / 1000) - 1;
    },
  };
}

test("install, scheduled threshold refill, stop/start and uninstall preserve payment authority", async (t) => {
  const f = await fixture(t);
  assert.equal((await serviceCommand("install", f.options, f.deps)).status, "approval_required");
  assert.equal(f.running(), false);
  assert.equal(
    (await serviceCommand("install", { ...f.options, approve: true }, f.deps)).status,
    "scheduled",
  );
  assert.equal(f.approved(), 1);
  await serviceCommand("install", f.options, f.deps);
  assert.equal(f.approved(), 1);
  assert.equal((await serviceTick(f.directory, f.deps)).status, "funded");
  assert.equal(f.paid(), 0);
  f.balance(0n);
  assert.equal((await serviceTick(f.directory, f.deps)).status, "submitted");
  await serviceCommand("stop", {}, f.deps);
  assert.equal((await serviceTick(f.directory, f.deps)).status, "stopped");
  await serviceCommand("start", {}, f.deps);
  assert.equal((await serviceTick(f.directory, f.deps)).status, "delivered");
  assert.equal((await serviceTick(f.directory, f.deps)).status, "cooldown");
  assert.equal(f.paid(), 1);
  await serviceCommand("uninstall", {}, f.deps);
  const saved = await loadState(f.stateDir);
  assert.equal(saved.spent, "50000");
  assert.equal(saved.history.length, 1);
  assert.equal(saved.authorization.key, f.grant().key);
  assert.equal((await serviceCommand("status", {}, f.deps)).installed, false);
  assert.equal((await stat(join(f.directory, "service.json"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.directory, "events.json"))).mode & 0o777, 0o600);
  await serviceCommand("install", f.options, f.deps);
  assert.equal(f.approved(), 1);
  assert.equal((await loadState(f.stateDir)).spent, "50000");
});

test("overlapping scheduled checks cannot submit twice; a restart reconciles the original order", async (t) => {
  const f = await fixture(t);
  await serviceCommand("install", { ...f.options, approve: true }, f.deps);
  f.balance(0n);
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const pay = f.io.pay;
  f.io.pay = async () => {
    await pay();
    entered();
    await wait;
    throw new Error("connection lost after payment");
  };
  const first = serviceTick(f.directory, f.deps);
  await started;
  assert.equal((await serviceTick(f.directory, f.deps)).status, "busy");
  release();
  assert.equal((await first).status, "error");
  assert.equal((await serviceTick(f.directory, f.deps)).status, "delivered");
  assert.equal(f.paid(), 1);
  assert.equal((await loadState(f.stateDir)).spent, "50000");
});

test("expiry blocks new payments but keeps reconciling a submitted refill", async (t) => {
  const f = await fixture(t);
  await serviceCommand("install", { ...f.options, approve: true }, f.deps);
  f.expire();
  f.balance(0n);
  assert.match((await serviceTick(f.directory, f.deps)).message, /expired/);
  assert.equal(f.paid(), 0);
  assert.equal((await serviceCommand("status", {}, f.deps)).authorization.remainingSeconds, 0);
  await assert.rejects(serviceCommand("start", {}, f.deps), /expired/);
  assert.equal(f.approved(), 1);
  const state = await loadState(f.stateDir);
  state.pending = { key: "glue-123", phase: "submitting", body: {} };
  state.spent = "50000";
  await f.io.save(state);
  await f.io.pay();
  assert.equal((await serviceTick(f.directory, f.deps)).status, "delivered");
  assert.equal(f.paid(), 1);
});

test("changed or missing installed policy/state never creates a fresh allowance", async (t) => {
  const f = await fixture(t);
  await serviceCommand("install", { ...f.options, approve: true }, f.deps);
  await atomicWrite(f.policy, { ...config, maxSpend: "1" });
  assert.match((await serviceTick(f.directory, f.deps)).message, /changed/);
  await assert.rejects(
    serviceCommand("install", { ...f.options, approve: true }, f.deps),
    /Uninstall/,
  );
  await atomicWrite(f.policy, config);
  await rm(join(f.stateDir, "state.json"));
  assert.match((await serviceTick(f.directory, f.deps)).message, /state is missing/);
  await assert.rejects(
    serviceCommand("install", { ...f.options, approve: true }, f.deps),
    /state is missing/,
  );
  assert.equal(f.approved(), 1);
  assert.equal(f.paid(), 0);
});

test("failed scheduler installation leaves payments disabled; logs stay bounded", async (t) => {
  const f = await fixture(t);
  f.deps.scheduler.start = async () => {
    throw new Error("scheduler unavailable");
  };
  await assert.rejects(
    serviceCommand("install", { ...f.options, approve: true }, f.deps),
    /scheduler unavailable/,
  );
  assert.equal((await serviceTick(f.directory, f.deps)).status, "stopped");
  const path = join(f.directory, "service.json");
  const record = JSON.parse(await readFile(path));
  await atomicWrite(path, { ...record, enabled: true });
  await atomicWrite(
    join(f.directory, "events.json"),
    Array.from({ length: 100 }, () => ({ status: "old" })),
  );
  await serviceTick(f.directory, f.deps);
  const events = await serviceCommand("logs", {}, f.deps);
  assert.equal(events.length, 100);
  assert.equal(events.at(-1).status, "funded");
});

test("uninstalled pending payment cannot be replaced by another job", async (t) => {
  const f = await fixture(t);
  await serviceCommand("install", { ...f.options, approve: true }, f.deps);
  f.balance(0n);
  await serviceTick(f.directory, f.deps);
  await serviceCommand("uninstall", {}, f.deps);
  const other = join(f.directory, "other.json");
  await atomicWrite(other, config);
  await assert.rejects(
    serviceCommand("install", { ...f.options, policy: other, approve: true }, f.deps),
    /Reconcile/,
  );
  assert.equal(f.paid(), 1);
  assert.equal(f.approved(), 1);
});
