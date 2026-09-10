import { address, policyHash, TOKENS, units, validateState } from "./worker.mjs";

export function walletKey(config, result, now) {
  const wallet = result.data ?? result;
  const key = wallet.key;
  if (
    wallet.ready !== true ||
    wallet.wallet?.toLowerCase() !== config.sender.toLowerCase() ||
    !key ||
    !address(key.address) ||
    key.wallet_address?.toLowerCase() !== config.sender.toLowerCase() ||
    key.chain_id !== 4217 ||
    key.status !== "ready" ||
    !Number.isFinite(Date.parse(key.expires_at)) ||
    Date.parse(key.expires_at) <= now
  )
    throw new Error("Connect a ready, unexpired Tempo mainnet key for this policy's sender.");
  return key;
}

export function checkAuthorization(config, approval, result, now) {
  const key = walletKey(config, result, now);
  if (
    !approval ||
    !["update_returned", "active"].includes(approval.phase) ||
    approval.policyHash !== policyHash(config) ||
    key.address.toLowerCase() !== approval.key ||
    !Number.isFinite(approval.expiresAt)
  )
    throw new Error("Run glue authorize for this policy; its approved key must still be selected.");
  const expiry = Math.min(
    approval.expiresAt,
    Date.parse(config.expiresAt),
    Date.parse(key.expires_at),
  );
  if (expiry <= now) throw new Error("Glue authorization expired. No new payment was attempted.");
  const limit = key.spending_limits?.find(
    (item) => item.token?.toLowerCase() === TOKENS[config.token],
  );
  if (
    !limit ||
    limit.unlimited !== false ||
    (limit.period_seconds != null && limit.period_seconds !== 0) ||
    units(limit.limit, 6) > units(approval.limit, 6)
  )
    throw new Error("Selected-token key limit is missing, recurring, or exceeds the approval.");
  // A reported ceiling is not a remaining balance. Glue's durable ledger owns its charge budget.
  return expiry;
}

export async function authorize(config, state, io, { approve = false } = {}) {
  validateState(config, state);
  const now = io.now();
  if (state.pending?.phase === "submitting")
    throw new Error("Reconcile the pending payment first.");
  if (state.paused) throw new Error("Policy is paused.");
  if (now >= Date.parse(config.expiresAt)) throw new Error("Policy expired.");
  const remaining = units(config.maxSpend, 6) - BigInt(state.spent);
  if (remaining < units(config.amount, 6)) throw new Error("Policy budget exhausted.");
  const wallet = await io.wallet();
  const key = walletKey(config, wallet, io.now());
  if (state.authorization) {
    if (state.authorization.phase === "pending")
      throw new Error(
        "Approval outcome is unresolved. It will not be submitted again; inspect Tempo Wallet. Keep this state.",
      );
    const expiry = checkAuthorization(config, state.authorization, wallet, io.now());
    state.authorization.phase = "active";
    state.authorization.expiresAt = expiry;
    await io.save(state);
    return { status: "authorized", key: key.address, expiresAt: new Date(expiry).toISOString() };
  }
  const limit = `${remaining / 1000000n}.${(remaining % 1000000n).toString().padStart(6, "0")}`;
  const request = {
    phase: "pending",
    policyHash: policyHash(config),
    key: key.address.toLowerCase(),
    limit,
    expiresAt: Math.min(Date.parse(config.expiresAt), Date.parse(key.expires_at)),
  };
  const preview = {
    status: "approval_required",
    key: request.key,
    token: TOKENS[config.token],
    limit,
    localExpiresAt: new Date(request.expiresAt).toISOString(),
    keyExpiresAt: key.expires_at,
    message:
      "This replaces the selected token allowance on your shared Tempo key. Other apps share it. Key expiry is unchanged. Network fees are additional.",
  };
  if (!approve) return preview;
  io.describe(preview);
  if (io.now() >= request.expiresAt) throw new Error("Policy expired before approval.");
  state.authorization = request;
  await io.save(state);
  await io.approveKey(request.key, TOKENS[config.token], limit);
  // Persist the successful CLI return before fetching wallet state. Never replay an uncertain update.
  state.authorization.phase = "update_returned";
  await io.save(state);
  const updated = await io.wallet();
  state.authorization.expiresAt = checkAuthorization(
    config,
    state.authorization,
    updated,
    io.now(),
  );
  state.authorization.phase = "active";
  await io.save(state);
  return {
    status: "authorized",
    key: request.key,
    expiresAt: new Date(request.expiresAt).toISOString(),
  };
}
