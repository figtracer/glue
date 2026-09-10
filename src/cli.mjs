#!/usr/bin/env node
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { authorize } from "./authorization.mjs";
import { validate, initialState, tick } from "./worker.mjs";
import { createIO, lock, loadState, atomicWrite } from "./io.mjs";

const help = `glue — bounded gas refills through Glue + Tempo Wallet

init --policy FILE --sender ADDRESS --recipient ADDRESS --chain base
     --token pathusd --below-eth 0.00002 --amount 0.25
     --min-receive-eth 0.00001 --max-spend 1 --expires-at UTC_TIMESTAMP
authorize --policy FILE [--approve]
run  --policy FILE [--execute --accept-network-fees] [--watch]
status --policy FILE
pause  --policy FILE

run is quote-only unless --execute is supplied. max-spend caps cumulative
MPP token charges, NOT additional Tempo network fees. Executing requires
--accept-network-fees and an already authorized Tempo Wallet.

--interval-seconds 60 / --cooldown-seconds 300 are init options.
--rpc URL / --api URL / --tempo PATH / --state-dir DIR are runtime options.
Use one persistent state directory; deleting/copying it can reset budgets.
authorize previews a shared-key allowance update; --approve opens Tempo passkey approval.
No VK, daemon installation or private-key handling. Key expiry remains managed by Tempo.
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
        "expires-at",
        "interval-seconds",
        "cooldown-seconds",
        "rpc",
        "api",
        "tempo",
        "state-dir",
      ].map((key) => [key, { type: "string" }]),
      ...["execute", "accept-network-fees", "watch", "approve", "help"].map((key) => [
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
  if (
    positionals.length !== 1 ||
    !["init", "authorize", "run", "status", "pause"].includes(command) ||
    !v.policy
  )
    throw new Error(help);
  const path = command === "init" ? resolve(v.policy) : await realpath(resolve(v.policy));
  if (command === "init") {
    const config = validate({
      version: 1,
      sender: v.sender,
      recipient: v.recipient,
      chain: v.chain,
      token: v.token,
      belowEth: v["below-eth"],
      amount: v.amount,
      minReceiveEth: v["min-receive-eth"],
      maxSpend: v["max-spend"],
      expiresAt: v["expires-at"],
      intervalSeconds: Number(v["interval-seconds"] ?? 60),
      cooldownSeconds: Number(v["cooldown-seconds"] ?? 300),
    });
    if (Date.parse(config.expiresAt) <= Date.now()) throw new Error("Choose a future expiry.");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(`Policy created: ${path}\nNothing enabled. Run without --execute to preview.`);
    return;
  }
  const config = validate(JSON.parse(await readFile(path, "utf8")));
  // The canonical policy path owns the state; edits cannot silently create a fresh budget.
  const id = createHash("sha256").update(path).digest("hex").slice(0, 24);
  const directory = resolve(v["state-dir"] ?? join(homedir(), ".local/state/glue", id));
  if (command === "status") {
    console.log(
      JSON.stringify(
        { policy: config, stateDirectory: directory, state: await loadState(directory) },
        null,
        2,
      ),
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
