import { formatUnits } from "viem";
import { address, policyHash, units, validateState } from "./worker.mjs";

export function checkGrant(config, approval, grant, now) {
  if (
    !grant ||
    !address(grant.key) ||
    grant.wallet?.toLowerCase() !== config.sender.toLowerCase() ||
    grant.chainId !== 4217 ||
    grant.revoked ||
    !grant.limited ||
    grant.period ||
    !Number.isSafeInteger(grant.expiry) ||
    grant.expiry <= Math.floor(now / 1000) ||
    !approval ||
    approval.policyHash !== policyHash(config) ||
    (approval.key && approval.key !== grant.key.toLowerCase()) ||
    BigInt(grant.limit) > BigInt(approval.limit)
  )
    throw new Error("Tempo authorization is missing, expired, revoked, or differs from this job.");
  if (approval.phase === "pending" && grant.expiry !== approval.requestExpiry)
    throw new Error("Tempo did not approve the requested expiry.");
  return grant.expiry * 1000;
}

export async function authorize(config, state, io, { approve = false } = {}) {
  validateState(config, state);
  if (config.version !== 2)
    throw new Error(
      "Legacy policies can reconcile payments. Create a new job with --duration for Tempo authorization.",
    );
  if (state.pending?.phase === "submitting")
    throw new Error("Reconcile the pending payment first.");
  if (state.paused) throw new Error("Policy is paused.");
  const remaining = units(config.maxSpend, 6) - BigInt(state.spent);
  if (remaining < units(config.amount, 6)) throw new Error("Policy budget exhausted.");
  if (!state.authorization) {
    if (!config.feeReserve)
      throw new Error(
        "A new Tempo grant requires an explicit --fee-reserve. Keep existing job state.",
      );
    const allowance = remaining + units(config.feeReserve, 6);
    const preview = {
      status: "approval_required",
      wallet: config.sender,
      token: config.token,
      amount: formatUnits(allowance, 6),
      payments: formatUnits(remaining, 6),
      feeReserve: config.feeReserve,
      durationSeconds: config.durationSeconds,
      message:
        "Approve a dedicated Glue key in Tempo Wallet. Tempo owns its expiry and token allowance.",
    };
    if (!approve) return preview;
    io.describe(preview);
    state.authorization = {
      phase: "pending",
      policyHash: policyHash(config),
      limit: allowance.toString(),
      requestExpiry: Math.floor(io.now() / 1000) + config.durationSeconds,
    };
    await io.save(state);
    await io.connect(state.authorization);
  }
  // The SDK saves the unique signed grant. Recovery reads it; it never repeats the ceremony.
  const grant = await io.authority(state.authorization.key);
  const expiry = checkGrant(config, state.authorization, grant, io.now());
  state.authorization = {
    phase: "active",
    policyHash: state.authorization.policyHash,
    limit: state.authorization.limit,
    key: grant.key.toLowerCase(),
  };
  await io.save(state);
  return {
    status: "authorized",
    key: grant.key,
    expiresAt: new Date(expiry).toISOString(),
    source: grant.source,
  };
}
