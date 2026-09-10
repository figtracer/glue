import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lock } from "../src/io.mjs";
const exec = promisify(execFile);
const cli = resolve("src/cli.mjs");

test("actual CLI previews, pays through child CLI, resumes delivery and obeys budget", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "glue-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sender = "0x1111111111111111111111111111111111111111",
    recipient = "0x2222222222222222222222222222222222222222";
  const config = {
    version: 1,
    sender,
    recipient,
    chain: "base",
    token: "pathusd",
    belowEth: "0.00002",
    amount: "0.05",
    minReceiveEth: "0.000001",
    maxSpend: "0.05",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    intervalSeconds: 30,
    cooldownSeconds: 30,
  };
  const policy = join(dir, "policy.json"),
    fake = join(dir, "tempo");
  await writeFile(policy, JSON.stringify(config));
  let paid = false,
    payments = 0;
  const keys = new Set();
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/rpc")
      return res.end(JSON.stringify({ result: body.method === "eth_chainId" ? "0x2105" : "0x0" }));
    if (req.url === "/api/status") return res.end(JSON.stringify({ status: "success" }));
    if (req.url !== "/api/refuel") {
      res.statusCode = 404;
      return res.end("{}");
    }
    keys.add(req.headers["idempotency-key"]);
    if (req.headers.authorization) {
      paid = true;
      payments++;
    }
    res.statusCode = paid ? 200 : 402;
    if (!paid) res.setHeader("WWW-Authenticate", "Payment fake");
    res.end(
      JSON.stringify({
        orderId: req.headers["idempotency-key"],
        recipient,
        chainId: 8453,
        token: body.token,
        amount: body.amount,
        paymentRecipient: sender,
        minimumEth: "0.00001",
        expiresAt: Date.now() + 60_000,
        status: paid ? "submitted" : "payment_required",
        statusUrl: "/api/status",
      }),
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const api = `http://127.0.0.1:${server.address().port}`;
  await writeFile(
    fake,
    `#!/usr/bin/env node\nconst args=process.argv.slice(2);\nif(args[0]==='wallet'){if(args[1]==='keys'){if(args[3]!=='0x3333333333333333333333333333333333333333'||args[args.indexOf('--limit')+1]!=='0.050000')process.exit(8);}else console.log(JSON.stringify({ready:true,wallet:'${sender}',key:{address:'0x3333333333333333333333333333333333333333',wallet_address:'${sender}',chain_id:4217,status:'ready',expires_at:'${config.expiresAt}',spending_limits:[{token:'0x20c0000000000000000000000000000000000000',limit:'0.05',unlimited:false,period_seconds:null}]}}));}else{\nconst option=k=>args[args.indexOf(k)+1];\nif(option('--max-spend')!=='0.05'||option('--payment-intent')!=='charge'||option('--retries')!=='0')process.exit(9);\nconst response=await fetch(args[1],{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':option('--header').split(': ')[1],Authorization:'test'},body:option('--json')});\nconst {writeFile}=await import('node:fs/promises');await writeFile(option('--output'),await response.text());}\n`,
    { mode: 0o700 },
  );
  const args = [
    "run",
    "--policy",
    policy,
    "--state-dir",
    join(dir, "state"),
    "--rpc",
    api + "/rpc",
    "--api",
    api,
    "--tempo",
    fake,
  ];
  const preview = await exec(process.execPath, [cli, ...args]);
  assert.match(preview.stdout, /"status":"quote"/);
  assert.equal(payments, 0);
  await assert.rejects(exec(process.execPath, [cli, ...args, "--execute"]), /accept-network-fees/);
  assert.equal(payments, 0);
  await assert.rejects(
    exec(process.execPath, [cli, ...args, "--execute", "--accept-network-fees"]),
    /glue authorize/,
  );
  const approval = await exec(process.execPath, [cli, "authorize", ...args.slice(1), "--approve"]);
  assert.match(approval.stdout, /"status":"authorized"/);
  const submitted = await exec(process.execPath, [
    cli,
    ...args,
    "--execute",
    "--accept-network-fees",
  ]);
  assert.match(submitted.stdout, /"status":"submitted"/);
  const delivered = await exec(process.execPath, [cli, ...args]);
  assert.match(delivered.stdout, /"status":"delivered"/);
  const exhausted = await exec(process.execPath, [
    cli,
    ...args,
    "--execute",
    "--accept-network-fees",
  ]);
  assert.match(exhausted.stdout, /budget_exhausted/);
  assert.equal(payments, 1);
  assert.equal(keys.size, 1);
  const state = JSON.parse(await readFile(join(dir, "state/state.json")));
  assert.equal(state.spent, "50000");
  assert.equal(state.history.length, 1);
  const unlock = await lock(join(dir, "state"));
  await assert.rejects(exec(process.execPath, [cli, ...args]), /Worker lock exists/);
  await unlock();
});
