import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createScheduler } from "../src/scheduler.mjs";
import { atomicWrite } from "../src/io.mjs";
import { initialState, policyHash } from "../src/worker.mjs";

const exec = promisify(execFile);
for (const platform of ["darwin", "linux"]) {
  test(`${platform} scheduler quotes paths and supports idempotent start, stop and removal`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "glue-scheduler-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const directory = join(home, 'spaces & <brackets> "quotes" $money %percent');
    const calls = [];
    let loaded = false;
    const scheduler = createScheduler(directory, {
      platform,
      home,
      uid: 501,
      run: async (command, args) => {
        calls.push([command, ...args]);
        if (args.includes("print")) {
          if (!loaded) throw Object.assign(new Error("missing"), { code: 113 });
          return { stdout: "loaded" };
        }
        if (args.includes("show"))
          return { stdout: `ActiveState=${loaded ? "active" : "inactive"}\n` };
        if (args.includes("bootstrap") || (args.includes("--now") && args.includes("enable")))
          loaded = true;
        if (args.includes("bootout") || (args.includes("disable") && args.includes("--now")))
          loaded = false;
        return { stdout: "" };
      },
    });
    await scheduler.start(60);
    assert.equal(await scheduler.loaded(), true);
    const files = await Promise.all(scheduler.files.map((p) => readFile(p, "utf8")));
    if (platform === "darwin") {
      assert.match(files[0], /&amp; &lt;brackets&gt; &quot;quotes&quot;/);
      assert.match(files[0], /<integer>60<\/integer>/);
      if (process.platform === "darwin") {
        await exec("/usr/bin/plutil", ["-lint", scheduler.files[0]]);
        const { stdout } = await exec("/usr/bin/plutil", [
          "-convert",
          "json",
          "-o",
          "-",
          scheduler.files[0],
        ]);
        assert.equal(JSON.parse(stdout).ProgramArguments.at(-1), directory);
      }
    } else {
      assert.match(files[0], /\$\$money %%percent/);
      assert.match(files[0], /Type=oneshot/);
      assert.match(files[1], /OnUnitInactiveSec=60s/);
      assert.match(files[1], /WantedBy=timers.target/);
      if (process.platform === "linux")
        await exec("systemd-analyze", ["verify", "--man=no", ...scheduler.files]);
    }
    const starts = () =>
      calls.filter(
        (args) => args.includes("bootstrap") || (args.includes("enable") && args.includes("--now")),
      ).length;
    await scheduler.start(60);
    assert.equal(starts(), 1);
    await scheduler.stop();
    assert.equal(await scheduler.loaded(), false);
    await scheduler.start(60);
    assert.equal(starts(), 2);
    await scheduler.stop();
    await scheduler.remove();
    for (const path of scheduler.files) await assert.rejects(readFile(path), { code: "ENOENT" });
  });
}

test("scheduler errors are surfaced and control characters cannot become unit directives", async () => {
  assert.throws(
    () => createScheduler("/tmp/bad\n[Service]", { platform: "linux" }),
    /control characters/,
  );
  const scheduler = createScheduler("/tmp/glue", {
    platform: "linux",
    run: async () => {
      throw new Error("no user bus");
    },
  });
  await assert.rejects(scheduler.start(60), /no user bus/);
});

test(
  "native user scheduler runs the actual CLI repeatedly and stops cleanly",
  {
    skip: process.env.GLUE_TEST_NATIVE_SERVICE !== "1",
    timeout: 90000,
  },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), "glue-native-scheduler-"));
    const directory = join(home, "service"),
      stateDirectory = join(home, "state");
    await mkdir(directory);
    await mkdir(stateDirectory);
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
    const policy = join(home, "policy.json");
    await atomicWrite(policy, config);
    const state = initialState(config);
    // Exhausted budget guarantees this real scheduled CLI cannot sign or pay.
    state.spent = "50000";
    await atomicWrite(join(stateDirectory, "state.json"), state);
    await atomicWrite(join(directory, "service.json"), {
      version: 1,
      installed: true,
      enabled: true,
      policy,
      stateDirectory,
      policyHash: policyHash(config),
    });
    const scheduler = createScheduler(directory, {
      label: `com.figtracer.glue.test-${process.pid}`,
    });
    t.after(async () => {
      if (await scheduler.loaded()) await scheduler.stop();
      await scheduler.remove();
      await rm(home, { recursive: true, force: true });
    });
    await scheduler.start(30);
    assert.equal(await scheduler.loaded(), true);
    let events = [];
    const deadline = Date.now() + 65000;
    while (events.length < 2 && Date.now() < deadline) {
      await sleep(1000);
      try {
        events = JSON.parse(await readFile(join(directory, "events.json")));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    assert.ok(events.length >= 2, "native scheduler should invoke the actual CLI at least twice");
    assert.ok(events.every((event) => event.status === "budget_exhausted"));
    await scheduler.stop();
    assert.equal(await scheduler.loaded(), false);
    await scheduler.remove();
    for (const file of scheduler.files) await assert.rejects(readFile(file), { code: "ENOENT" });
    assert.equal(JSON.parse(await readFile(join(stateDirectory, "state.json"))).spent, "50000");
  },
);
