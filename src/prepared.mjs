import { CHAINS, units } from "./worker.mjs";
import { DEFAULT_RPC } from "./io.mjs";

// Estimate the whole sequence on one mainnet state, including earlier calls'
// deployments and writes. Never silently fall back to independent eth_call runs.
export async function estimatePrepared(config, options = {}) {
  const [{ createPublicClient, http, parseAbi, zeroAddress }, chains] = await Promise.all([
    import("viem"),
    import("viem/chains"),
  ]);
  const chain = {
    base: chains.base,
    ethereum: chains.mainnet,
    optimism: chains.optimism,
    arbitrum: chains.arbitrum,
  }[config.chain];
  const url = new URL(options.rpc ?? DEFAULT_RPC[config.chain]);
  if (url.protocol !== "https:") throw new Error("Prepared funding requires a mainnet HTTPS RPC.");
  const client = createPublicClient({
    chain,
    transport: http(url.href, { retryCount: 0, timeout: 30000 }),
  });
  if ((await client.getChainId()) !== CHAINS[config.chain])
    throw new Error("RPC chain differs from the prepared job.");
  options.signal?.throwIfAborted();
  const blockNumber = await client.getBlockNumber();
  const [nonce, pricing] = await Promise.all([
    client.getTransactionCount({ address: config.recipient, blockNumber }),
    client.estimateFeesPerGas(),
  ]);
  const calls = config.transactions.map((tx, index) => ({
    account: config.recipient,
    to: tx.to ?? null,
    data: tx.data ?? "0x",
    value: units(tx.value ?? "0", 18),
    nonce: nonce + index,
  }));
  const [simulated] = await client.simulateBlocks({
    blockNumber,
    validation: false,
    blocks: [{ calls, stateOverrides: [{ address: config.recipient, balance: 2n ** 128n }] }],
  });
  if (simulated.calls.length !== calls.length)
    throw new Error("Incomplete prepared transaction simulation.");
  let fees = 0n,
    value = 0n;
  for (let index = 0; index < calls.length; index++) {
    options.signal?.throwIfAborted();
    const call = calls[index],
      result = simulated.calls[index];
    if (result.status !== "success")
      throw new Error(
        `Prepared transaction ${index + 1} reverts: ${result.error?.shortMessage ?? result.error?.message ?? "simulation failed"}`,
      );
    let gas = result.gasUsed;
    let extra = 0n;
    if (["base", "optimism"].includes(config.chain)) {
      const { estimateL1Fee } = await import("viem/op-stack");
      const [l1, operator] = await Promise.all([
        estimateL1Fee(client, { ...call, to: call.to ?? undefined }),
        client.readContract({
          address: chain.contracts.gasPriceOracle.address,
          abi: parseAbi(["function getOperatorFee(uint256 gasUsed) view returns (uint256)"]),
          functionName: "getOperatorFee",
          args: [gas],
          blockNumber,
        }),
      ]);
      extra = l1 + operator;
    } else if (config.chain === "arbitrum") {
      // Nitro's L1-only estimate works even if a destination is created by an
      // earlier transaction. The configurable gas margin also pads this estimate.
      const [l1Gas] = await client.readContract({
        address: "0x00000000000000000000000000000000000000c8",
        abi: parseAbi([
          "function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)",
        ]),
        functionName: "gasEstimateL1Component",
        args: [call.to ?? zeroAddress, !call.to, call.data],
        account: config.recipient,
        blockNumber,
      });
      gas += l1Gas;
    }
    fees += gas * pricing.maxFeePerGas + extra;
    // Conservatively reserve every outgoing native value; do not depend on a
    // later refund or transfer returning ETH to the payer.
    value += call.value;
  }
  return value + (fees * BigInt(10000 + config.marginBps) + 9999n) / 10000n;
}
