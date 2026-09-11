import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile),
  cli = resolve("src/cli.mjs");
test("CLI creates a duration-based job and previews its Tempo grant without logging in", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "glue-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const policy = join(dir, "job.json");
  await exec(process.execPath, [
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
  ]);
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
});

test("CLI lists shipped services without creating a job", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "glue-catalog-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = (...args) => exec(process.execPath, [cli, ...args], { cwd: dir });
  const { stdout, stderr } = await run("services");
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    `glue services — pay from Tempo with pathUSD or USDC.e

gas · Gas maintenance · local
  Watch native ETH and refill below your threshold.
  https://github.com/figtracer/glue/blob/main/docs/services/gas.md
  glue install gas --policy FILE --accept-network-fees --approve

refuel · On-demand refuel · web/mpp
  Get gas now through the website or MPP API, including Sepolia routes.
  https://glue.figtracer.com/llms.txt

No Glue fees. Network and provider costs apply. Nothing enabled.
`,
  );
  const all = JSON.parse((await run("services", "--json")).stdout);
  assert.deepEqual(
    all.map(({ id, runs }) => ({ id, runs })),
    [
      { id: "gas", runs: "local" },
      { id: "refuel", runs: "web/mpp" },
    ],
  );
  for (const service of all) {
    const result = JSON.parse((await run("services", service.id, "--json")).stdout);
    assert.deepEqual(result, [service]);
  }
  assert.deepEqual(all[0].chains, ["base", "ethereum", "arbitrum", "optimism"]);
  assert.deepEqual(all[0].tokens, ["pathusd", "usdc.e"]);
  assert.equal(all[1].command, undefined);
  assert.deepEqual(await readdir(dir), []);
  for (const args of [
    ["services", "unknown"],
    ["services", "gas", "extra"],
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
