#!/usr/bin/env node
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { parseArgs, promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { authorize } from "./authorization.mjs";
import { CHAINS, TOKENS, address, validate, initialState, tick } from "./worker.mjs";
import { createIO, inspectJob, lock, loadState, atomicWrite, stateDirectory } from "./io.mjs";

import { serviceCommand, serviceTick } from "./service.mjs";

const runtime = ["rpc", "api", "state-dir"];
const commands = {
  services: { usage: "services [gas|refuel] [--json]", flags: ["json"] },
  init: {
    usage:
      "init --policy FILE --recipient ADDRESS --chain CHAIN --token TOKEN\n  --below-eth ETH --amount AMOUNT --min-receive-eth ETH\n  --max-spend AMOUNT --fee-reserve AMOUNT --duration 30m [--sender ADDRESS]",
    flags: [
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
    ],
  },
  authorize: {
    usage: "authorize --policy FILE [--approve]",
    flags: ["policy", "approve", ...runtime],
  },
  run: {
    usage: "run --policy FILE [--execute --accept-network-fees] [--watch]",
    flags: ["policy", "execute", "accept-network-fees", "watch", ...runtime],
  },
  install: {
    usage: "install gas --policy FILE --accept-network-fees [--approve]",
    flags: ["policy", "accept-network-fees", "approve", ...runtime],
  },
  start: { usage: "start gas", flags: [] },
  stop: { usage: "stop gas", flags: [] },
  uninstall: { usage: "uninstall gas", flags: [] },
  logs: { usage: "logs gas", flags: [] },
  status: { usage: "status [gas | --policy FILE] [--json]", flags: ["policy", "json", ...runtime] },
  pause: { usage: "pause --policy FILE", flags: ["policy", "state-dir"] },
  "service-tick": { usage: "service-tick [--service-dir DIR]", flags: ["service-dir"] },
};
const help = `glue — small services for agents using Tempo

services  Browse services
init      Configure gas maintenance
authorize Preview or approve a Tempo grant
install   Enable local gas maintenance
status    Inspect a job
logs      Read recent events
start / stop / uninstall
run / pause

Use glue COMMAND --help. No Glue fees; network and provider costs apply.
`;

async function sender() {
  try {
    const { stdout } = await promisify(execFile)(
      join(homedir(), ".tempo/bin/tempo"),
      ["wallet", "whoami", "--format", "json"],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    const identity = JSON.parse(stdout);
    if (
      identity.ready !== true ||
      identity.key?.chain_id !== 4217 ||
      !address(identity.wallet) ||
      identity.key?.wallet_address?.toLowerCase() !== identity.wallet.toLowerCase()
    )
      throw new Error();
    return identity.wallet;
  } catch {
    throw new Error("Cannot read a connected Tempo mainnet wallet. Supply --sender ADDRESS.");
  }
}

async function printStatus(result, json) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  if (result.installed === false && !result.job && !result.policy)
    return console.log("gas · not installed");
  const { formatUnits } = await import("viem");
  const config = result.job ?? result.policy;
  const grant = result.authorization ?? result.authority;
  const state = result.state;
  const pending = result.pending ?? state?.pending?.key;
  const mode =
    result.paused || state?.paused
      ? "paused"
      : "installed" in result
        ? result.installed && result.enabled && result.scheduled
          ? "scheduled"
          : "stopped"
        : "manual";
  console.log(`gas · ${config?.chain ?? "unknown"} · ${mode}`);
  console.log(
    `balance   ${result.balance == null ? "unavailable" : formatUnits(BigInt(result.balance), 18) + " ETH"}`,
  );
  console.log(
    `allowance ${grant ? formatUnits(BigInt(grant.limit), 6) + " " + config.token : "not authorized"}`,
  );
  console.log(
    `expires   ${grant ? grant.expiresAt + (grant.remainingSeconds === 0 ? " (expired)" : "") : "—"}`,
  );
  console.log(`pending   ${pending ?? "none"}`);
  if (result.lastRun) console.log(`last      ${result.lastRun.status}`);
  if (result.error) console.log(`error     ${result.error}`);
}

async function main() {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(
      [...new Set(["help", ...Object.values(commands).flatMap(({ flags }) => flags)])].map(
        (key) => [
          key,
          {
            type: ["execute", "accept-network-fees", "watch", "approve", "help", "json"].includes(
              key,
            )
              ? "boolean"
              : "string",
          },
        ],
      ),
    ),
  });
  const [command] = positionals;
  if (!command) {
    if (Object.keys(v).some((key) => key !== "help"))
      throw new Error("Choose a command. Use glue --help.");
    console.log(help);
    return;
  }
  const spec = Object.hasOwn(commands, command) ? commands[command] : null;
  if (!spec) throw new Error(`Unknown command: ${command}. Use glue --help.`);
  for (const key of Object.keys(v))
    if (key !== "help" && !spec.flags.includes(key))
      throw new Error(`--${key} is not supported by ${command}.`);
  if (v.help) {
    console.log(`glue ${spec.usage}`);
    const extra = spec.flags.filter((flag) => !spec.usage.includes(`--${flag}`));
    if (extra.length) console.log(`Options: ${extra.map((flag) => "--" + flag).join(", ")}`);
    if (command === "init")
      console.log(
        "Sender defaults to the connected Tempo mainnet wallet. Amounts and duration are required; interval defaults to 60s and cooldown to 300s.",
      );
    if (command === "run")
      console.log(
        "Quote-only unless --execute is supplied. Runtime overrides: --rpc, --api, --state-dir.",
      );
    return;
  }
  if (command === "status" && !v.policy && (v.rpc || v.api || v["state-dir"]))
    throw new Error(
      "Installed status uses its saved settings; runtime overrides require --policy.",
    );
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
    if (positionals.length !== 1) throw new Error(`Use glue ${spec.usage}`);
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
      throw new Error(`Use glue ${spec.usage}`);
    const result = await serviceCommand(command, v);
    if (command === "status") {
      await printStatus(result, v.json);
      if (result.error) process.exitCode = 1;
    } else console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (
    positionals.length !== 1 ||
    !["init", "authorize", "run", "status", "pause"].includes(command) ||
    !v.policy
  )
    throw new Error(`Use glue ${spec.usage}`);
  const path = command === "init" ? resolve(v.policy) : await realpath(resolve(v.policy));
  if (command === "init") {
    if (!v["fee-reserve"])
      throw new Error("Choose an explicit --fee-reserve for Tempo network fees.");
    const config = validate({
      version: 2,
      sender: v.sender ?? (await sender()),
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
    const details = await inspectJob(state, createIO(config, directory, v));
    const error = details.errors.join("; ");
    if (error) process.exitCode = 1;
    await printStatus(
      { policy: config, stateDirectory: directory, state, ...details, ...(error ? { error } : {}) },
      v.json,
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
