import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { CHAINS, TOKENS } from "./worker.mjs";

const exec = promisify(execFile);
export const DEFAULT_RPC = {
  base: "https://mainnet.base.org",
  ethereum: "https://ethereum-rpc.publicnode.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  optimism: "https://mainnet.optimism.io",
};

export async function atomicWrite(path, value) {
  const tmp = `${path}.tmp`;
  const handle = await open(tmp, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
  const directory = await open(resolve(path, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function lock(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "run.lock");
  let file;
  try {
    file = await open(path, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `Worker lock exists: ${path}. If its recorded PID has exited, remove only run.lock; keep state.json and receipts.`,
      );
    throw error;
  }
  await file.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await file.close();
  return () => unlink(path);
}

export async function loadState(directory) {
  try {
    return JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function safeUrl(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Use HTTPS, or HTTP on loopback for testing.");
  return url;
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  return { status: response.status, body, challenge: response.headers.get("WWW-Authenticate") };
}

export function createIO(config, directory, options = {}) {
  const api = safeUrl(options.api ?? "https://glue.figtracer.com");
  const rpc = safeUrl(options.rpc ?? DEFAULT_RPC[config.chain]);
  const tempo = options.tempo ?? join(homedir(), ".tempo/bin/tempo");
  async function chainCall(method, params) {
    const reply = await jsonFetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (reply.status !== 200 || reply.body.error || !/^0x[0-9a-f]+$/i.test(reply.body.result ?? ""))
      throw new Error(`RPC failed for ${method}.`);
    return BigInt(reply.body.result);
  }
  return {
    now: () => Date.now(),
    save: (state) => atomicWrite(join(directory, "state.json"), state),
    async balance() {
      if ((await chainCall("eth_chainId", [])) !== BigInt(CHAINS[config.chain]))
        throw new Error("RPC chain does not match the policy.");
      return chainCall("eth_getBalance", [config.recipient, "latest"]);
    },
    order: (pending) =>
      jsonFetch(new URL("/api/refuel", api), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key },
        body: JSON.stringify(pending.body),
      }),
    async receipt(path) {
      const url = new URL(path, api);
      if (url.origin !== api.origin || url.pathname !== "/api/status")
        throw new Error("Unexpected receipt URL.");
      const response = await jsonFetch(url);
      if (response.status !== 200)
        throw new Error(`Receipt unavailable (HTTP ${response.status}).`);
      return response.body;
    },
    async verifyWallet() {
      const { stdout } = await exec(tempo, ["wallet", "whoami", "--format", "json"], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      const result = JSON.parse(stdout);
      const wallet = result.wallet ?? result.data?.wallet;
      if (typeof wallet !== "string" || wallet.toLowerCase() !== config.sender.toLowerCase())
        throw new Error("Tempo Wallet payer does not match the approved policy.");
    },
    async pay(pending) {
      const remaining =
        Math.min(Date.parse(config.expiresAt), pending.offer.expiresAt) - Date.now();
      if (remaining <= 0)
        throw new Error("Approval or offer expired before payment; inspect pending state.");
      const output = join(directory, `${pending.key}.response.json`);
      // Create private files before invoking the CLI; it must not emit payment artifacts to the terminal.
      await atomicWrite(output, {});
      try {
        await exec(
          tempo,
          [
            "request",
            new URL("/api/refuel", api).href,
            "--network",
            "tempo",
            "--payment-intent",
            "charge",
            "--payment-token",
            TOKENS[config.token],
            "--max-spend",
            config.amount,
            "--retries",
            "0",
            "--timeout",
            String(Math.max(1, Math.floor(remaining / 1000))),
            "--header",
            `Idempotency-Key: ${pending.key}`,
            "--json",
            JSON.stringify(pending.body),
            "--output",
            output,
          ],
          { timeout: remaining, maxBuffer: 1024 * 1024 },
        );
      } catch {
        throw new Error(
          "Tempo payment did not return cleanly. Submission remains pending; run again to reconcile, never delete its state to retry.",
        );
      }
    },
  };
}
