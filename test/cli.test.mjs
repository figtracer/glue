import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile),
  cli = resolve("src/cli.mjs");
test(
  "CLI creates a duration-based job and previews its Tempo grant without logging in",
  { timeout: 30000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "glue-cli-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const policy = join(dir, "job.json");
    const args = [
      cli,
      "init",
      "--policy",
      policy,
      "--sender",
      "0x1111111111111111111111111111111111111111",
      "--recipient",
      "0x2222222222222222222222222222222222222222",
      "--chain",
      "base",
      "--token",
      "pathusd",
      "--below-eth",
      "0.00001",
      "--amount",
      "0.05",
      "--min-receive-eth",
      "0.000001",
      "--max-spend",
      "0.05",
      "--fee-reserve",
      "0.01",
      "--duration",
      "30m",
    ];
    await exec(process.execPath, args);
    const home = join(dir, "home");
    await mkdir(join(home, ".tempo/bin"), { recursive: true });
    const tempo = join(home, ".tempo/bin/tempo");
    const inferred = args.filter((_, i) => i !== 4 && i !== 5);
    inferred[3] = join(dir, "inferred.json");
    const identity = {
      ready: true,
      wallet: args[5],
      key: { chain_id: 4217, wallet_address: args[5] },
    };
    await writeFile(
      tempo,
      `#!/bin/sh\n[ "$*" = "wallet whoami --format json" ] || exit 9\nprintf '%s' '${JSON.stringify(identity)}'\n`,
      { mode: 0o700 },
    );
    await exec(process.execPath, inferred, { env: { ...process.env, HOME: home } });
    assert.equal(JSON.parse(await readFile(inferred[3])).sender, args[5]);
    for (const bad of [
      "not json",
      JSON.stringify({ ...identity, key: { chain_id: 42431 } }),
      JSON.stringify({ ...identity, ready: false }),
    ]) {
      await writeFile(tempo, `#!/bin/sh\nprintf '%s' '${bad}'\n`);
      await assert.rejects(
        exec(process.execPath, inferred, { env: { ...process.env, HOME: home } }),
        /Supply --sender ADDRESS/,
      );
    }
    const config = JSON.parse(await readFile(policy));
    assert.equal(config.durationSeconds, 1800);
    assert.equal(config.expiresAt, undefined);
    const result = await exec(process.execPath, [
      cli,
      "authorize",
      "--policy",
      policy,
      "--state-dir",
      join(dir, "state"),
    ]);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.status, "approval_required");
    assert.equal(preview.amount, "0.06");
    assert.equal(preview.payments, "0.05");
    assert.equal(preview.feeReserve, "0.01");
    await assert.rejects(readFile(join(dir, "state/state.json")), { code: "ENOENT" });
    let hang = false;
    let received;
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      if (hang) return received();
      res.end(
        JSON.stringify({
          result: JSON.parse(body).method === "eth_chainId" ? "0x2105" : "0xde0b6b3a7640000",
        }),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const runtime = [
      "--policy",
      policy,
      "--state-dir",
      join(dir, "state"),
      "--rpc",
      `http://127.0.0.1:${server.address().port}`,
    ];
    assert.equal(
      (await exec(process.execPath, [cli, "status", ...runtime])).stdout,
      "gas · base · manual\nbalance   1 ETH\nallowance not authorized\nexpires   —\npending   none\n",
    );
    const status = JSON.parse(
      (await exec(process.execPath, [cli, "status", ...runtime, "--json"])).stdout,
    );
    assert.equal(status.balance, "1000000000000000000");
    assert.equal(status.state, null);
    assert.equal(status.authority, null);
    hang = true;
    const request = new Promise((resolve) => {
      received = resolve;
    });
    const child = spawn(process.execPath, [cli, "run", ...runtime]);
    t.after(() => child.kill("SIGKILL"));
    const closed = new Promise((resolve) => child.on("close", resolve));
    await request;
    child.kill("SIGTERM");
    assert.equal(await closed, 1);
    await assert.rejects(readFile(join(dir, "state/run.lock")), { code: "ENOENT" });
  },
);

test("CLI lists shipped services without creating a job", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "glue-catalog-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = (...args) => exec(process.execPath, [cli, ...args], { cwd: dir });
  const { stdout, stderr } = await run("services");
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    `glue services — pay from Tempo with pathUSD or USDC.e

refill · Refill · local
  Maintain one wallet, a fleet, prepared work, or a Tempo payment-token balance.
  https://github.com/figtracer/glue/blob/main/docs/services/refill.md
  glue init refill --help

refuel · On-demand refuel · web/mpp
  Get ETH or Tron TRX now through the website or MPP API, including Sepolia ETH.
  https://glue.figtracer.com/llms.txt

No Glue fees. Network and provider costs apply. Nothing enabled.
`,
  );
  const all = JSON.parse((await run("services", "--json")).stdout);
  assert.deepEqual(
    all.map(({ id, runs }) => ({ id, runs })),
    [
      { id: "refill", runs: "local" },
      { id: "refuel", runs: "web/mpp" },
    ],
  );
  for (const service of all) {
    const result = JSON.parse((await run("services", service.id, "--json")).stdout);
    assert.deepEqual(result, [service]);
  }
  for (const alias of ["gas", "ready", "fleet", "reserve"]) {
    const result = JSON.parse((await run("services", alias, "--json")).stdout);
    assert.deepEqual(result, [all[0]]);
  }
  assert.deepEqual(all[0].chains, ["base", "ethereum", "arbitrum", "optimism"]);
  assert.deepEqual(all[1].chains, [
    "base",
    "ethereum",
    "arbitrum",
    "optimism",
    "robinhood",
    "tron",
  ]);
  assert.deepEqual(all[0].tokens, ["pathusd", "usdc.e"]);
  assert.deepEqual(
    all[0].modes.map(({ id }) => id),
    ["wallet", "fleet", "prepared", "tempo-token"],
  );
  assert.equal(all.at(-1).command, undefined);
  assert.deepEqual(await readdir(dir), []);
  for (const args of [
    ["services", "unknown"],
    ["services", "refill", "extra"],
    ["services", "--approve"],
    ["services", "--policy", join(dir, "job.json")],
    ["run", "--json"],
  ]) {
    await assert.rejects(run(...args), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      return true;
    });
  }
});

test("CLI infers every refill mode without changing legacy policy shapes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "glue-refill-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sender = "0x1111111111111111111111111111111111111111";
  const recipient = "0x2222222222222222222222222222222222222222";
  const transactions = join(dir, "transactions.json");
  const wallets = join(dir, "wallets.json");
  await writeFile(transactions, JSON.stringify([{ to: recipient, data: "0x", value: "0" }]));
  await writeFile(
    wallets,
    JSON.stringify([{ recipient, chain: "base", belowEth: "0.00002", active: true, priority: 1 }]),
  );
  const commonArgs = [
    "--sender",
    sender,
    "--token",
    "pathusd",
    "--amount",
    "0.05",
    "--max-spend",
    "0.25",
    "--fee-reserve",
    "0.01",
    "--duration",
    "30m",
  ];
  const shared = {
    sender,
    token: "pathusd",
    amount: "0.05",
    maxSpend: "0.25",
    feeReserve: "0.01",
    durationSeconds: 1800,
    intervalSeconds: 60,
    cooldownSeconds: 300,
  };
  const cases = [
    {
      mode: "wallet",
      args: [
        "--chain",
        "base",
        "--recipient",
        recipient,
        "--below-eth",
        "0.00002",
        "--min-receive-eth",
        "0.000001",
      ],
      legacy: ["gas"],
      expected: {
        version: 2,
        sender,
        recipient,
        chain: "base",
        token: "pathusd",
        belowEth: "0.00002",
        amount: "0.05",
        minReceiveEth: "0.000001",
        maxSpend: "0.25",
        durationSeconds: 1800,
        intervalSeconds: 60,
        cooldownSeconds: 300,
        feeReserve: "0.01",
      },
    },
    {
      mode: "fleet",
      args: ["--wallets", wallets],
      legacy: ["fleet"],
      expected: {
        version: 3,
        service: "fleet",
        ...shared,
        wallets: [{ recipient, chain: "base", belowEth: "0.00002", active: true, priority: 1 }],
      },
    },
    {
      mode: "prepared",
      args: ["--transactions", transactions, "--chain", "base", "--recipient", recipient],
      legacy: ["ready"],
      expected: {
        version: 3,
        service: "ready",
        ...shared,
        chain: "base",
        recipient,
        transactions: [{ to: recipient, data: "0x", value: "0" }],
        marginBps: 2000,
      },
    },
    {
      mode: "tempo-token",
      args: ["--chain", "tempo", "--receive-token", "usdc.e", "--target", "0.10"],
      legacy: ["gas", "reserve"],
      expected: {
        version: 3,
        service: "reserve",
        ...shared,
        receiveToken: "usdc.e",
        target: "0.10",
        slippageBps: 50,
      },
    },
  ];
  for (const item of cases) {
    const policy = join(dir, `${item.mode}.json`);
    const result = await exec(process.execPath, [
      cli,
      "init",
      "refill",
      "--policy",
      policy,
      ...commonArgs,
      ...item.args,
    ]);
    assert.match(result.stdout, new RegExp(`Mode: ${item.mode}`));
    assert.deepEqual(JSON.parse(await readFile(policy)), item.expected);
    for (const [index, alias] of item.legacy.entries()) {
      const legacyPolicy = join(dir, `${item.mode}-${alias}-${index}.json`);
      const legacyArgs =
        alias === "reserve" ? ["--receive-token", "usdc.e", "--target", "0.10"] : item.args;
      await exec(process.execPath, [
        cli,
        "init",
        alias,
        "--policy",
        legacyPolicy,
        ...commonArgs,
        ...legacyArgs,
      ]);
      assert.deepEqual(JSON.parse(await readFile(legacyPolicy)), item.expected);
    }
  }
  const pausedState = join(dir, "paused-state");
  await exec(process.execPath, [
    cli,
    "pause",
    "--policy",
    join(dir, "wallet.json"),
    "--state-dir",
    pausedState,
  ]);
  assert.equal(JSON.parse(await readFile(join(pausedState, "state.json"))).paused, true);
});

test("CLI rejects mixed refill modes before reading files or wallet state", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "glue-refill-invalid-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const common = [
    "--policy",
    join(dir, "never-created.json"),
    "--token",
    "pathusd",
    "--amount",
    "0.05",
    "--max-spend",
    "0.25",
    "--fee-reserve",
    "0.01",
    "--duration",
    "30m",
  ];
  for (const mode of [
    [],
    [
      "--wallets",
      join(dir, "missing-wallets.json"),
      "--transactions",
      join(dir, "missing-txs.json"),
    ],
    ["--wallets", join(dir, "missing-wallets.json"), "--chain", "base"],
    ["--receive-token", "usdc.e", "--target", "0.10"],
    ["--margin-bps", "100"],
    ["--chain", "tempo", "--receive-token", "usdc.e", "--target", "0.10", "--below-eth", "0.1"],
  ]) {
    await assert.rejects(
      exec(process.execPath, [cli, "init", "refill", ...common, ...mode], {
        env: { ...process.env, HOME: join(dir, "empty-home") },
      }),
      (error) => error.code === 1 && error.stdout === "",
    );
  }
  assert.deepEqual(await readdir(dir), []);
});

test("CLI help is scoped and unrelated flags fail before IO", async () => {
  const commands = [
    "list",
    "services",
    "init",
    "authorize",
    "run",
    "install",
    "start",
    "stop",
    "uninstall",
    "retire",
    "activate",
    "logs",
    "status",
    "pause",
    "service-tick",
  ];
  for (const command of commands) {
    const result = await exec(process.execPath, [cli, command, "--help"]);
    assert.match(result.stdout, new RegExp(`^glue ${command}`));
    assert.equal(result.stderr, "");
  }
  const refillHelp = await exec(process.execPath, [cli, "init", "refill", "--help"]);
  assert.match(refillHelp.stdout, /One wallet:/);
  assert.match(refillHelp.stdout, /Tempo token:/);
  assert.equal((await exec(process.execPath, [cli, "stop", "--help"])).stdout, "glue stop NAME\n");
  for (const args of [
    ["stop", "gas", "--approve"],
    ["init", "--execute"],
    ["pause", "--rpc", "https://example.com"],
    ["status", "--rpc", "https://example.com"],
    ["services", "--watch"],
    ["--approve"],
    ["constructor"],
  ]) {
    await assert.rejects(exec(process.execPath, [cli, ...args]), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      return true;
    });
  }
});
