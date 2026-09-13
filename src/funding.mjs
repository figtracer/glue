import { randomUUID } from "node:crypto";
import { address, CHAINS, TOKENS, units, gasTick, validate } from "./worker.mjs";
import { atomicWrite } from "./io.mjs";
import { join } from "node:path";
import { estimatePrepared } from "./prepared.mjs";

const common = [
  "version",
  "service",
  "sender",
  "token",
  "amount",
  "maxSpend",
  "feeReserve",
  "durationSeconds",
  "intervalSeconds",
  "cooldownSeconds",
];
export function validateFunding(config) {
  const extra = {
    ready: ["chain", "recipient", "transactions", "marginBps"],
    fleet: ["wallets"],
    reserve: ["receiveToken", "target", "slippageBps"],
  }[config.service];
  if (
    !extra ||
    Object.keys(config).some((key) => ![...common, ...extra].includes(key)) ||
    [...common, ...extra].some((key) => !(key in config))
  )
    throw new Error("Invalid service configuration. Use glue init SERVICE --help.");
  // Retain the same amount, timing and allowance rules as existing gas jobs.
  validate({
    version: 2,
    sender: config.sender,
    recipient: config.sender,
    chain: "base",
    token: config.token,
    belowEth: "0.000001",
    minReceiveEth: "0.000001",
    ...Object.fromEntries(
      common
        .filter((key) => !["version", "service", "sender", "token"].includes(key))
        .map((key) => [key, config[key]]),
    ),
  });
  if (config.service === "ready") {
    if (
      !CHAINS[config.chain] ||
      !address(config.recipient) ||
      !Array.isArray(config.transactions) ||
      !config.transactions.length
    )
      throw new Error("Provide a chain, deployer and nonempty prepared transaction list.");
    if (!Number.isInteger(config.marginBps) || config.marginBps < 0 || config.marginBps > 10000)
      throw new Error("Gas margin must be 0–10000 basis points.");
    for (const tx of config.transactions) {
      if (
        !tx ||
        Object.keys(tx).some((key) => !["to", "data", "value"].includes(key)) ||
        (tx.to != null && !address(tx.to)) ||
        !/^0x(?:[a-f0-9]{2})*$/i.test(tx.data ?? "0x") ||
        units(tx.value ?? "0", 18) < 0n
      )
        throw new Error("Prepared transactions accept to, data and a decimal ETH value only.");
    }
  }
  if (config.service === "fleet") {
    if (!Array.isArray(config.wallets) || !config.wallets.length)
      throw new Error("Provide at least one fleet wallet.");
    const seen = new Set();
    for (const wallet of config.wallets) {
      const id = `${wallet.chain}:${wallet.recipient?.toLowerCase()}`;
      if (
        Object.keys(wallet).some(
          (key) => !["recipient", "chain", "belowEth", "active", "priority"].includes(key),
        ) ||
        !CHAINS[wallet.chain] ||
        !address(wallet.recipient) ||
        typeof wallet.active !== "boolean" ||
        !Number.isSafeInteger(wallet.priority) ||
        wallet.priority < 0 ||
        units(wallet.belowEth, 18) <= 0n ||
        seen.has(id)
      )
        throw new Error(
          "Fleet wallets need unique chain/address pairs, belowEth, active and priority.",
        );
      seen.add(id);
    }
  }
  if (config.service === "reserve") {
    if (
      !TOKENS[config.receiveToken] ||
      config.receiveToken === config.token ||
      units(config.target, 6) <= 0n ||
      !Number.isInteger(config.slippageBps) ||
      config.slippageBps < 0 ||
      config.slippageBps > 100
    )
      throw new Error(
        "Choose another supported reserve token, a positive target and 0–100 slippage basis points.",
      );
  }
  return Object.fromEntries([...common, ...extra].map((key) => [key, config[key]]));
}

export async function fundingBalances(config, io, state = {}) {
  if (config.service === "reserve") {
    const wallet = await io.wallet();
    return [
      {
        token: config.receiveToken,
        balance: (await wallet.tokenBalance(config.receiveToken)).toString(),
        target: units(config.target, 6).toString(),
      },
    ];
  }
  const wallets = config.service === "fleet" ? config.wallets : [config];
  return Promise.all(
    wallets.map(async (wallet) => ({
      chain: wallet.chain,
      recipient: wallet.recipient,
      active:
        ((wallet.active ?? true) ||
          (state.activated ?? []).includes(`${wallet.chain}:${wallet.recipient.toLowerCase()}`)) &&
        !(state.retired ?? []).includes(`${wallet.chain}:${wallet.recipient.toLowerCase()}`),
      balance: (await io.forConfig(wallet).balance()).toString(),
      target: (config.service === "ready"
        ? await estimatePrepared(config, io.options)
        : units(wallet.belowEth, 18)
      ).toString(),
    })),
  );
}

export async function fundingTick(config, state, io, { execute = false } = {}) {
  if (config.service === "reserve") return reserveTick(config, state, io, { execute });
  // A saved selection owns a submission until delivery is resolved. Fleet members
  // cannot each spend the full parent allowance or pay around a pending refill.
  if (state.pending?.phase === "submitting") {
    if (!state.refuel) throw new Error("Pending refill has no saved target; inspect state.");
    return gasTick(state.refuel, state, io.forConfig(state.refuel), { execute });
  }
  if (state.paused) return { status: "paused" };
  if (
    state.lastDeliveredAt !== null &&
    io.now() - state.lastDeliveredAt < config.cooldownSeconds * 1000
  )
    return { status: "cooldown" };
  const balances = await fundingBalances(config, io, state);
  const candidates = balances.filter(
    (wallet) => wallet.active && BigInt(wallet.balance) < BigInt(wallet.target),
  );
  if (!candidates.length)
    return {
      status: config.service === "ready" ? "ready" : "funded",
      balances,
      checkedAt: new Date(io.now()).toISOString(),
    };
  if (config.service === "fleet")
    candidates.sort((a, b) => {
      const priority = (item) =>
        config.wallets.find((w) => w.chain === item.chain && w.recipient === item.recipient)
          .priority;
      return priority(b) - priority(a);
    });
  const target = candidates[0];
  const { formatUnits } = await import("viem");
  const remaining = units(config.maxSpend, 6) - BigInt(state.spent);
  if (remaining <= 0n) return { status: "budget_exhausted" };
  const ceiling = remaining < units(config.amount, 6) ? remaining : units(config.amount, 6);
  const gap = BigInt(target.target) - BigInt(target.balance);
  const selected = {
    ...Object.fromEntries(
      common.filter((key) => key !== "service").map((key) => [key, config[key]]),
    ),
    version: 2,
    chain: target.chain,
    recipient: target.recipient,
    belowEth: formatUnits(BigInt(target.target), 18),
    minReceiveEth: formatUnits(gap, 18),
    amount: formatUnits(ceiling, 6),
  };
  // First quote the maximum, then reduce the source amount in proportion to the
  // minimum output. Check the final minimum again; never rely on a price estimate.
  const probe = {
    key: `glue-${randomUUID()}`,
    body: {
      sender: config.sender,
      recipient: target.recipient,
      chainId: CHAINS[target.chain],
      amount: selected.amount,
      token: TOKENS[config.token],
    },
  };
  const quote = await io.forConfig(selected).order(probe);
  if (
    quote.status !== 402 ||
    quote.body.orderId !== probe.key ||
    quote.body.chainId !== CHAINS[target.chain] ||
    quote.body.recipient?.toLowerCase() !== target.recipient.toLowerCase() ||
    quote.body.token?.toLowerCase() !== TOKENS[config.token] ||
    units(quote.body.amount, 6) !== ceiling
  )
    throw new Error("Funding quote does not match this job.");
  const output = units(quote.body.minimumEth, 18);
  if (output < gap)
    return {
      status: "insufficient_refill_limit",
      recipient: target.recipient,
      requiredEth: formatUnits(gap, 18),
      minimumEth: quote.body.minimumEth,
      maxAmount: selected.amount,
    };
  // Bound quote discovery to three attempts: proportional pricing first, then
  // one midpoint when fixed route costs make that small request unfillable.
  let best = probe;
  const scaled = (ceiling * gap + output - 1n) / output;
  if (scaled > 0n && scaled < ceiling) {
    for (const amount of new Set([scaled, (scaled + ceiling + 1n) / 2n])) {
      const candidate = {
        key: `glue-${randomUUID()}`,
        body: { ...probe.body, amount: formatUnits(amount, 6) },
      };
      const reply = await io.forConfig(selected).order(candidate);
      if (
        reply.status === 402 &&
        reply.body.orderId === candidate.key &&
        units(reply.body.minimumEth, 18) >= gap
      ) {
        best = candidate;
        break;
      }
    }
  }
  selected.amount = best.body.amount;
  // Only unsigned quotes are replaced. gasTick rechecks every quote field and
  // current balance before it can reserve budget and sign.
  state.pending = { ...best, phase: "quoted" };
  state.refuel = selected;
  await io.save(state);
  const result = await gasTick(selected, state, io.forConfig(selected), { execute });
  return {
    ...result,
    recipient: target.recipient,
    chain: target.chain,
    requiredEth: formatUnits(gap, 18),
  };
}

async function reserveTick(config, state, io, { execute }) {
  const wallet = await io.wallet();
  if (state.pending) {
    if (state.pending.kind !== "swap") throw new Error("Unexpected pending reserve operation.");
    if (!state.pending.hash)
      return {
        status: "payment_unknown",
        message: "Interrupted before a signed swap was recorded; inspect the job before retrying.",
      };
    const receipt = await wallet.swapReceipt(state.pending.hash);
    if (!receipt)
      return {
        status: io.now() >= state.pending.validBefore * 1000 ? "payment_unknown" : "pending",
        transaction: state.pending.hash,
      };
    if (receipt.status !== "success") {
      state.paused = true;
      await io.save(state);
      return {
        status: "needs_attention",
        transaction: state.pending.hash,
        reason: "swap_reverted",
      };
    }
    const outcome = wallet.swapOutcome(receipt, config.receiveToken);
    if (outcome < BigInt(state.pending.output))
      throw new Error("Swap receipt does not prove the expected token delivery.");
    state.history.push({
      transaction: state.pending.hash,
      received: outcome.toString(),
      token: config.receiveToken,
      deliveredAt: new Date(io.now()).toISOString(),
    });
    state.pending = null;
    state.lastDeliveredAt = io.now();
    await io.save(state);
    return { status: "delivered", ...state.history.at(-1) };
  }
  if (state.paused) return { status: "paused" };
  const balance = await wallet.tokenBalance(config.receiveToken);
  const output = units(config.target, 6) - balance;
  if (output <= 0n)
    return { status: "funded", token: config.receiveToken, balance: balance.toString() };
  if (
    state.lastDeliveredAt !== null &&
    io.now() - state.lastDeliveredAt < config.cooldownSeconds * 1000
  )
    return { status: "cooldown" };
  const quote = await wallet.quoteSwap(output);
  const maximum = (quote * BigInt(10000 + config.slippageBps) + 9999n) / 10000n;
  if (maximum > units(config.amount, 6))
    return { status: "insufficient_swap_limit", maximumInput: maximum.toString() };
  if (BigInt(state.spent) + maximum > units(config.maxSpend, 6))
    return { status: "budget_exhausted" };
  if (!execute)
    return {
      status: "quote",
      tokenIn: config.token,
      tokenOut: config.receiveToken,
      output: output.toString(),
      maximumInput: maximum.toString(),
    };
  const { formatUnits, keccak256 } = await import("viem");
  await io.verifyWallet(formatUnits(maximum, 6));
  io.options.signal?.throwIfAborted();
  if ((await wallet.tokenBalance(config.receiveToken)) !== balance)
    return { status: "balance_changed" };
  // Signing is local and cannot pay. A preparation error leaves the budget and
  // grant reusable; only a complete signed operation enters the submission state.
  const { signed, validBefore } = await wallet.signSwap(output, maximum, io.options.signal);
  io.options.signal?.throwIfAborted();
  state.pending = {
    kind: "swap",
    key: `glue-${randomUUID()}`,
    phase: "submitting",
    output: output.toString(),
    maximumInput: maximum.toString(),
    hash: keccak256(signed),
    validBefore,
  };
  state.spent = (BigInt(state.spent) + maximum).toString();
  await atomicWrite(join(io.directory, `${state.pending.key}.transaction.json`), { signed });
  await io.save(state);
  io.options.signal?.throwIfAborted();
  if (io.now() >= validBefore * 1000)
    return { status: "payment_unknown", transaction: state.pending.hash };
  const hash = await wallet.broadcastSwap(signed);
  if (hash.toLowerCase() !== state.pending.hash.toLowerCase())
    throw new Error("Broadcast hash differs from the saved swap.");
  return { status: "submitted", transaction: state.pending.hash };
}
