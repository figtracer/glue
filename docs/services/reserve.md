# Tempo token reserve

keep the payment token ready.

`reserve` watches a token balance in your existing Tempo wallet. Below your target, it buys only the missing amount through Tempo's stablecoin DEX. No bridge or Glue payment endpoint is involved.

## Set up

```sh
glue init reserve --policy reserve.local.json \
  --token usdc.e --receive-token pathusd --target 0.10 \
  --amount 0.15 --max-spend 1 --fee-reserve 0.03 --duration 1h

glue run --policy reserve.local.json
glue install payments --policy reserve.local.json --accept-network-fees --approve
```

This keeps at least 0.10 pathUSD available, buying a shortfall with USDC.e. Reverse the tokens to maintain USDC.e. The target is the wallet's total balance, so existing funds count. `--amount` caps the input for one swap; `--max-spend` caps cumulative input reservations.

The default slippage bound is 50 basis points (0.5%); change it with `--slippage-bps`, up to 100. The worker quotes exact output and enforces maximum input onchain. Insufficient liquidity or budget stops the action. Source-token network fees still apply.

## Authority and recovery

Tempo grants permission to approve the DEX and call its exact-output swap, with a limited source-token allowance and expiry. Glue approves only the quoted maximum and clears any remaining DEX allowance in the same atomic transaction. The selected output token and target remain Glue job rules.

Glue saves the signed transaction and its hash before broadcast. Later checks follow that same hash and confirm output-token delivery from the transaction receipt. An ambiguous payment never causes another swap. Reserved input remains conservatively counted even if the actual input is smaller; fees are additionally bounded by Tempo's allowance.

```sh
glue status payments
glue logs payments
glue stop payments
```

No automatic approval renewal. No Glue fees, account or subscription. See [operations](../operations.md).
