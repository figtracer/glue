import { createHash, randomUUID } from "node:crypto";

export const TOKENS = {
  pathusd: "0x20c0000000000000000000000000000000000000",
  "usdc.e": "0x20c000000000000000000000b9537d11c60e8b50",
};
export const CHAINS = { base: 8453, ethereum: 1, arbitrum: 42161, optimism: 10 };
export const address = (value) =>
  typeof value === "string" && /^0x[\da-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);

export function units(value, decimals) {
  if (
    typeof value !== "string" ||
    !new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${decimals}})?$`).test(value)
  )
    throw new Error(`Expected a decimal string with at most ${decimals} decimal places.`);
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (result >= 2n ** 256n) throw new Error("Amount exceeds uint256.");
  return result;
}

export function validate(config) {
  const fields = [
    "version",
    "sender",
    "recipient",
    "chain",
    "token",
    "belowEth",
    "amount",
    "minReceiveEth",
    "maxSpend",
    "expiresAt",
    "intervalSeconds",
    "cooldownSeconds",
  ];
  if (
    !config ||
    Object.keys(config).some((key) => !fields.includes(key)) ||
    fields.some((key) => !(key in config))
  )
    throw new Error("Invalid policy fields; use init to generate a policy.");
  if (
    config.version !== 1 ||
    !address(config.sender) ||
    !address(config.recipient) ||
    !CHAINS[config.chain] ||
    !TOKENS[config.token]
  )
    throw new Error("Invalid version, wallet, chain or token.");
  for (const [key, precision] of [
    ["belowEth", 18],
    ["minReceiveEth", 18],
    ["amount", 6],
    ["maxSpend", 6],
  ])
    if (units(config[key], precision) <= 0n) throw new Error(`${key} must be positive.`);
  if (units(config.amount, 6) > units(config.maxSpend, 6))
    throw new Error("A refill exceeds the total charge budget.");
  if (
    typeof config.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(config.expiresAt)) ||
    !config.expiresAt.endsWith("Z")
  )
    throw new Error("expiresAt must be a UTC ISO timestamp ending in Z.");
  for (const key of ["intervalSeconds", "cooldownSeconds"])
    if (!Number.isSafeInteger(config[key]) || config[key] < 30 || config[key] > 86400)
      throw new Error(`${key} must be 30–86400 seconds (avoid rapid polling/refill loops).`);
  return Object.fromEntries(fields.map((key) => [key, config[key]]));
}

export function policyHash(config) {
  return createHash("sha256")
    .update(JSON.stringify(validate(config)))
    .digest("hex");
}

export function initialState(config) {
  return {
    version: 1,
    policyHash: policyHash(config),
    spent: "0",
    pending: null,
    lastDeliveredAt: null,
    paused: false,
    history: [],
  };
}

export function validateState(config, state) {
  if (state.version !== 1 || state.policyHash !== policyHash(config))
    throw new Error(
      "Policy changed. Restore the original policy to reconcile orders; create a separate policy only after stopping the old job.",
    );
  if (
    !/^\d+$/.test(state.spent) ||
    typeof state.paused !== "boolean" ||
    !Array.isArray(state.history)
  )
    throw new Error("Invalid state; do not reset a possibly paid job.");
  if (
    state.pending &&
    (!/^glue-[a-f0-9-]+$/.test(state.pending.key) ||
      !["quoted", "submitting"].includes(state.pending.phase))
  )
    throw new Error("Invalid pending order; inspect state before continuing.");
}

function validateOffer(config, pending, reply, now) {
  const q = reply.body;
  if (
    q.orderId !== pending.key ||
    q.recipient?.toLowerCase() !== config.recipient.toLowerCase() ||
    q.chainId !== CHAINS[config.chain] ||
    q.token?.toLowerCase() !== TOKENS[config.token] ||
    units(q.amount, 6) !== units(config.amount, 6)
  )
    throw new Error("Glue order does not match the policy.");
  if (
    reply.status !== 402 ||
    !reply.challenge ||
    !address(q.paymentRecipient) ||
    !Number.isFinite(q.expiresAt) ||
    q.expiresAt <= now ||
    units(q.minimumEth, 18) < units(config.minReceiveEth, 18)
  )
    throw new Error("Offer expired, incomplete, or below minimum ETH delivery.");
  return q;
}

// The worker has one delivery adapter: Glue. Payment authority remains in Tempo Wallet.
// Persist before invoking the paying CLI. An uncertain submission is never paid again.
export async function tick(config, state, io, { execute = false } = {}) {
  validateState(config, state);
  const now = io.now();
  if (state.pending?.phase === "submitting") {
    const reply = await io.order(state.pending);
    const q = reply.body;
    if (reply.status === 402 || reply.status === 410)
      return {
        status: "payment_unknown",
        message:
          "Payment may have been submitted. No new payment will be attempted; inspect the saved order and Tempo Wallet.",
      };
    if (![200, 202].includes(reply.status) || q.orderId !== state.pending.key)
      throw new Error(`Cannot reconcile order (HTTP ${reply.status}); retaining pending payment.`);
    if (["refunded", "payment_failed", "failed"].includes(q.status)) {
      state.paused = true;
      state.pending.result = q;
      await io.save(state);
      return { status: "needs_attention", order: q.orderId, reason: q.status };
    }
    if (!q.statusUrl) return { status: "pending", order: q.orderId };
    const receipt = await io.receipt(q.statusUrl);
    if (receipt.status === "success") {
      state.history.push({
        key: state.pending.key,
        body: state.pending.body,
        payment: q.paymentHash,
        deliveredAt: new Date(now).toISOString(),
        receipt,
      });
      state.pending = null;
      state.lastDeliveredAt = now;
      await io.save(state);
      return { status: "delivered", order: q.orderId };
    }
    if (["refund", "failure", "fallback"].includes(receipt.status)) {
      state.paused = true;
      await io.save(state);
      return { status: "needs_attention", order: q.orderId, reason: receipt.status };
    }
    return { status: "pending", order: q.orderId };
  }
  if (state.paused) return { status: "paused" };
  if (now >= Date.parse(config.expiresAt)) return { status: "expired" };
  if (BigInt(state.spent) + units(config.amount, 6) > units(config.maxSpend, 6))
    return { status: "budget_exhausted" };
  if (state.lastDeliveredAt !== null && now - state.lastDeliveredAt < config.cooldownSeconds * 1000)
    return { status: "cooldown" };
  const balance = await io.balance();
  if (balance >= units(config.belowEth, 18)) {
    if (state.pending) {
      state.pending = null;
      await io.save(state);
    }
    return { status: "funded", balanceWei: balance.toString() };
  }
  if (!state.pending) {
    state.pending = {
      key: `glue-${randomUUID()}`,
      phase: "quoted",
      body: {
        sender: config.sender,
        recipient: config.recipient,
        chainId: CHAINS[config.chain],
        amount: config.amount,
        token: TOKENS[config.token],
      },
    };
    await io.save(state);
  }
  let reply = await io.order(state.pending);
  if (reply.status === 410) {
    // Only a never-submitted order may be replaced automatically.
    state.pending.key = `glue-${randomUUID()}`;
    await io.save(state);
    reply = await io.order(state.pending);
  }
  const offer = validateOffer(config, state.pending, reply, io.now());
  state.pending.offer = offer;
  await io.save(state);
  if (!execute)
    return {
      status: "quote",
      balanceWei: balance.toString(),
      amount: config.amount,
      minimumEth: offer.minimumEth,
      order: state.pending.key,
    };
  const authorizedUntil = (await io.verifyWallet()) ?? Date.parse(config.expiresAt);
  // Recheck time and live balance after quote/wallet IO, immediately before charging.
  if (io.now() >= Math.min(authorizedUntil, Date.parse(config.expiresAt), offer.expiresAt))
    return { status: "expired" };
  if ((await io.balance()) >= units(config.belowEth, 18)) return { status: "funded" };
  if (io.now() >= Math.min(authorizedUntil, Date.parse(config.expiresAt), offer.expiresAt))
    return { status: "expired" };
  state.pending.phase = "submitting";
  state.pending.submittedAt = new Date(io.now()).toISOString();
  state.spent = (BigInt(state.spent) + units(config.amount, 6)).toString();
  await io.save(state);
  await io.pay(state.pending);
  return { status: "submitted", order: state.pending.key };
}
