import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { checkGrant } from "./authorization.mjs";
import { CHAINS, units } from "./worker.mjs";

export const DEFAULT_RPC = {
  base: "https://mainnet.base.org",
  ethereum: "https://ethereum-rpc.publicnode.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  optimism: "https://mainnet.optimism.io",
};

export function stateDirectory(policy, override, home = homedir()) {
  const id = createHash("sha256").update(policy).digest("hex").slice(0, 24);
  return resolve(override ?? join(home, ".local/state/glue", id));
}

export async function atomicWrite(path, value) {
  return atomicWriteText(path, JSON.stringify(value, null, 2) + "\n");
}

export async function atomicWriteText(path, text) {
  const tmp = `${path}.tmp`;
  const handle = await open(tmp, "w", 0o600);
  try {
    await handle.writeFile(text);
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
    if (error.code === "EEXIST") {
      const busy = new Error(
        `Worker lock exists: ${path}. If its recorded PID has exited, remove only run.lock; keep state.json and receipts.`,
      );
      busy.code = "GLUE_LOCKED";
      throw busy;
    }
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
    signal: AbortSignal.any([
      AbortSignal.timeout(30_000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  const body = await response.json();
  return { status: response.status, body, challenge: response.headers.get("WWW-Authenticate") };
}

export function createIO(config, directory, options = {}, wallet) {
  // Balance checks and receipt recovery do not need a signing provider.
  let walletPromise;
  const getWallet = () =>
    (walletPromise ??= wallet
      ? Promise.resolve(wallet)
      : import("./wallet.mjs").then(({ createWallet }) => createWallet(config, directory)));
  const api = safeUrl(options.api ?? "https://glue.figtracer.com");
  const rpc = safeUrl(options.rpc ?? DEFAULT_RPC[config.chain]);
  async function chainCall(method, params) {
    const reply = await jsonFetch(rpc, {
      signal: options.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (reply.status !== 200 || reply.body.error || !/^0x[0-9a-f]+$/i.test(reply.body.result ?? ""))
      throw new Error(`RPC failed for ${method}.`);
    return BigInt(reply.body.result);
  }
  let authorizedUntil = 0;
  let approvedKey;
  async function verifyWallet() {
    const state = await loadState(directory);
    if (state?.authorization?.phase !== "active")
      throw new Error("Run glue authorize --policy FILE --approve first.");
    approvedKey = state.authorization.key;
    const grant = await (await getWallet()).authority(approvedKey);
    authorizedUntil = checkGrant(config, state.authorization, grant, Date.now());
    if (BigInt(grant.limit) <= units(config.amount, 6))
      throw new Error(
        "Tempo allowance cannot cover the refill plus network fees. No payment attempted.",
      );
    return authorizedUntil;
  }
  return {
    connect: async (approval) => (await getWallet()).connect(approval),
    authority: async (key) => (await getWallet()).authority(key),
    describe: (value) => console.log(JSON.stringify(value)),
    verifyWallet,
    now: () => Date.now(),
    save: (state) => atomicWrite(join(directory, "state.json"), state),
    async balance() {
      if ((await chainCall("eth_chainId", [])) !== BigInt(CHAINS[config.chain]))
        throw new Error("RPC chain does not match the policy.");
      return chainCall("eth_getBalance", [config.recipient, "latest"]);
    },
    order: (pending) =>
      jsonFetch(new URL("/api/refuel", api), {
        signal: options.signal,
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key },
        body: JSON.stringify(pending.body),
      }),
    async receipt(path) {
      const url = new URL(path, api);
      if (url.origin !== api.origin || url.pathname !== "/api/status")
        throw new Error("Unexpected receipt URL.");
      const response = await jsonFetch(url, { signal: options.signal });
      if (response.status !== 200)
        throw new Error(`Receipt unavailable (HTTP ${response.status}).`);
      return response.body;
    },
    async pay(pending) {
      await verifyWallet();
      options.signal?.throwIfAborted();
      const timeout = Math.min(authorizedUntil, pending.offer.expiresAt) - Date.now();
      if (timeout <= 0) throw new Error("Tempo grant or quote expired.");
      const url = new URL("/api/refuel", api);
      const init = {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": pending.key },
        body: JSON.stringify(pending.body),
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      };
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.any([init.signal, ...(options.signal ? [options.signal] : [])]),
      });
      if (response.status !== 402)
        throw new Error("Order changed before payment; reconcile the saved order.");
      const credential = await (await getWallet()).credential(pending, response, approvedKey);
      await atomicWrite(join(directory, `${pending.key}.credential.json`), { credential });
      options.signal?.throwIfAborted();
      if (Date.now() >= Math.min(authorizedUntil, pending.offer.expiresAt))
        throw new Error("Tempo grant or quote expired before submission.");
      const paid = await fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: credential },
      });
      await atomicWrite(join(directory, `${pending.key}.response.json`), await paid.json());
      if (![200, 202].includes(paid.status))
        throw new Error("Payment outcome unresolved; reconcile the saved order.");
    },
  };
}

// Read balance and authority independently so one unavailable provider does not hide the other.
export async function inspectJob(state, io) {
  const [balance, authority] = await Promise.allSettled([
    io.balance(),
    state?.authorization?.phase === "active" ? io.authority(state.authorization.key) : null,
  ]);
  const grant = authority.status === "fulfilled" ? authority.value : null;
  return {
    balance: balance.status === "fulfilled" ? balance.value.toString() : null,
    authority: grant
      ? {
          ...grant,
          remaining: grant.limit,
          expiresAt: new Date(grant.expiry * 1000).toISOString(),
          remainingSeconds: Math.max(0, grant.expiry - Math.floor(Date.now() / 1000)),
        }
      : null,
    errors: [balance, authority]
      .filter((item) => item.status === "rejected")
      .map((item) => item.reason.message),
  };
}
