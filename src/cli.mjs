#!/usr/bin/env node
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { authorize } from "./authorization.mjs";
import { CHAINS, TOKENS, validate, initialState, tick } from "./worker.mjs";
import { createIO, lock, loadState, atomicWrite, stateDirectory } from "./io.mjs";

import { serviceCommand, serviceTick } from "./service.mjs";

const help = `glue — small services for agents using Tempo

services [gas|refuel] [--json]
init --policy FILE --sender ADDRESS --recipient ADDRESS --chain base
     --token pathusd --below-eth 0.00002 --amount 0.25
     --min-receive-eth 0.00001 --max-spend 1 --fee-reserve 0.01 --duration 30m
authorize --policy FILE [--approve]
run  --policy FILE [--execute --accept-network-fees] [--watch]
install gas --policy FILE --accept-network-fees [--approve]
start gas / stop gas / uninstall gas
status [gas] / logs gas
status --policy FILE
pause  --policy FILE

run is quote-only unless --execute is supplied. max-spend caps cumulative
MPP token charges. --fee-reserve adds headroom to the native Tempo allowance
for network fees; Tempo caps their combined spend. Executing requires
--accept-network-fees and an already authorized Tempo Wallet.

--interval-seconds 60 / --cooldown-seconds 300 are init options.
--rpc URL / --api URL / --state-dir DIR are runtime options.
Use one persistent state directory; deleting/copying it can reset budgets.
authorize previews a dedicated key grant; --approve opens Tempo passkey approval.
Tempo owns the grant expiry and token limit. install uses a local user scheduler.
`;

async function main() {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries([
      ...[
        "policy",
        "sender",
        "recipient",
        "chain",
        "token",
        "below-eth",
        "amount",
        "min-receive-eth",
        "max-spend",
        "fee-reserve",
        "duration",
        "interval-seconds",
        "cooldown-seconds",
        "rpc",
        "api",
        "state-dir",
        "service-dir",
      ].map((key) => [key, { type: "string" }]),
      ...["execute", "accept-network-fees", "watch", "approve", "help", "json"].map((key) => [
        key,
        { type: "boolean" },
      ]),
    ]),
  });
  const [command] = positionals;
  if (v.help || !command) {
    console.log(help);
    return;
  }
  if (v.json && command !== "services") throw new Error("--json is available for services.");
  if (command === "services") {
    const services = [
      {
        id: "gas",
        name: "Gas maintenance",
        description: "Watch native ETH and refill below your threshold.",
        runs: "local",
        chains: Object.keys(CHAINS),
        tokens: Object.keys(TOKENS),
        docs: "https://github.com/figtracer/glue/blob/main/docs/services/gas.md",
        command: "glue install gas --policy FILE --accept-network-fees --approve",
      },
      {
        id: "refuel",
        name: "On-demand refuel",
        description: "Get gas now through the website or MPP API, including Sepolia routes.",
        runs: "web/mpp",
        tokens: Object.keys(TOKENS),
        docs: "https://glue.figtracer.com/llms.txt",
        website: "https://glue.figtracer.com",
      },
    ];
    const selected = positionals[1]
      ? services.filter((service) => service.id === positionals[1])
      : services;
    if (positionals.length > 2 || !selected.length)
      throw new Error("Use glue services [gas|refuel] [--json].");
    if (Object.keys(v).some((key) => key !== "json"))
      throw new Error("services only accepts --json; it does not configure or enable jobs.");
    if (v.json) console.log(JSON.stringify(selected, null, 2));
    else {
      console.log("glue services — pay from Tempo with pathUSD or USDC.e\n");
      for (const service of selected) {
        console.log(`${service.id} · ${service.name} · ${service.runs}`);
        console.log(`  ${service.description}`);
        console.log(`  ${service.docs}`);
        if (service.command) console.log(`  ${service.command}`);
        console.log();
      }
      console.log("No Glue fees. Network and provider costs apply. Nothing enabled.");
    }
    return;
  }
  if (command === "service-tick") {
    if (positionals.length !== 1) throw new Error(help);
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      const result = await serviceTick(v["service-dir"], { signal: controller.signal });
      console.log(JSON.stringify(result));
      if (["error", "needs_attention", "payment_unknown"].includes(result.status))
        process.exitCode = 2;
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
    return;
  }
  if (
    ["install", "start", "stop", "uninstall", "logs"].includes(command) ||
    (command === "status" && !v.policy)
  ) {
    if (
      (positionals[1] !== "gas" && !(command === "status" && positionals.length === 1)) ||
      positionals.length > 2
    )
      throw new Error(help);
    const result = await serviceCommand(command, v);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (
    positionals.length !== 1 ||
    !["init", "authorize", "run", "status", "pause"].includes(command) ||
    !v.policy
  )
    throw new Error(help);
  const path = command === "init" ? resolve(v.policy) : await realpath(resolve(v.policy));
  if (command === "init") {
    if (!v["fee-reserve"])
      throw new Error("Choose an explicit --fee-reserve for Tempo network fees.");
    const config = validate({
      version: 2,
      sender: v.sender,
      recipient: v.recipient,
      chain: v.chain,
      token: v.token,
      belowEth: v["below-eth"],
      amount: v.amount,
      minReceiveEth: v["min-receive-eth"],
      maxSpend: v["max-spend"],
      feeReserve: v["fee-reserve"],
      durationSeconds: (() => {
        const match = /^(\d+)(s|m|h)$/.exec(v.duration ?? "");
        if (!match) throw new Error("Use --duration 30m (s, m or h).");
        return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
      })(),
      intervalSeconds: Number(v["interval-seconds"] ?? 60),
      cooldownSeconds: Number(v["cooldown-seconds"] ?? 300),
    });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(`Policy created: ${path}\nNothing enabled. Run without --execute to preview.`);
    return;
  }
  const config = validate(JSON.parse(await readFile(path, "utf8")));
  // The canonical policy path owns the state; edits cannot silently create a fresh budget.
  const directory = stateDirectory(path, v["state-dir"]);
  if (command === "status") {
    const state = await loadState(directory);
    let authority;
    if (state?.authorization?.phase === "active") {
      try {
        const grant = await createIO(config, directory, v).authority(state.authorization.key);
        authority = {
          ...grant,
          expiresAt: new Date(grant.expiry * 1000).toISOString(),
          remainingSeconds: Math.max(0, grant.expiry - Math.floor(Date.now() / 1000)),
        };
      } catch (error) {
        authority = { status: "unavailable", message: error.message };
        process.exitCode = 1;
      }
    }
    console.log(
      JSON.stringify({ policy: config, stateDirectory: directory, state, authority }, null, 2),
    );
    return;
  }
  if (v.execute && !v["accept-network-fees"])
    throw new Error(
      "The charge budget excludes Tempo network fees. Supply --accept-network-fees to execute.",
    );
  const unlock = await lock(directory);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const state = (await loadState(directory)) ?? initialState(config);
    if (command === "pause") {
      state.paused = true;
      await atomicWrite(join(directory, "state.json"), state);
      console.log("Paused new refills. Run again to reconcile any existing payment.");
      return;
    }
    const io = createIO(config, directory, { ...v, signal: controller.signal });
    if (command === "authorize") {
      console.log(
        JSON.stringify(await authorize(config, state, io, { approve: Boolean(v.approve) })),
      );
      return;
    }
    console.log(
      JSON.stringify({
        mode: v.execute ? "execute" : "quote-only",
        policy: config,
        stateDirectory: directory,
        networkFees: "additional; not included in maxSpend",
      }),
    );
    do {
      // Refuse changes during a running job, including seemingly harmless budget edits.
      const latest = validate(JSON.parse(await readFile(path, "utf8")));
      let result;
      try {
        result = await tick(latest, state, io, { execute: Boolean(v.execute) });
      } catch (error) {
        console.error(JSON.stringify({ status: "error", message: error.message }));
        process.exitCode = 1;
        break;
      }
      console.log(JSON.stringify(result));
      if (["payment_unknown", "needs_attention"].includes(result.status)) process.exitCode = 2;
      if (
        !v.watch ||
        ["expired", "budget_exhausted", "paused", "payment_unknown", "needs_attention"].includes(
          result.status,
        )
      )
        break;
      try {
        await sleep(config.intervalSeconds * 1000, undefined, { signal: controller.signal });
      } catch (error) {
        if (error.name !== "AbortError") throw error;
      }
    } while (!controller.signal.aborted);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await unlock();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
