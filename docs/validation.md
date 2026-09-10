# Workflow validation

2026-09-10, Node v25.9.0; Tempo request v0.11.0 and wallet v0.11.0.

## Automated

`npm run check` and `npm test`: syntax validation plus 14 passing tests. The CLI integration test starts a loopback RPC/Glue server and a fake Tempo executable, then exercises preview, explicit execution, persisted delivery recovery, budget exhaustion and lock exclusion. No real payments occur in automated tests.

State tests cover both source tokens, unchanged unpaid order reuse, funded wallets, quote mismatches, minimum ETH output, expiry during IO, pending delivery, pause/cooldown, policy edits and refunds. A simulated crash after the payment checkpoint recovers without another paying invocation.

## Live

A user-authorized test used the existing Tempo Wallet and one Base destination. The temporary threshold was set one wei above the observed balance to deliberately exercise the refill path. Policy duration: 15 minutes. Total MPP charge budget: 0.05 pathUSD, allowing one refill. Tempo network fees were explicitly accepted separately.

Commands, using ignored local policy/state:

```sh
node src/cli.mjs run --policy .glue/live.local.json --state-dir .glue/live-state
node src/cli.mjs run --policy .glue/live.local.json --state-dir .glue/live-state \
  --execute --accept-network-fees --watch
```

Observed: `quote` → `submitted` → `delivered` → `budget_exhausted`, clean exit. One payment, one delivery, no pending order. Destination balance increased by 7,280,897,899,945 wei (0.000007280897899945 ETH). Base RPC independently confirmed a successful native transfer of that amount to the authorized destination.

Wallet addresses, payment artifacts and the live policy remain local and gitignored. No recurring worker or OS scheduled task remains running. The test is not a throughput or latency benchmark. The 30-second test poll interval means the receipt-observation timestamp is not the actual delivery latency.

VK approval, scoped-key enrollment, hosted execution, Sepolia maintenance and in-house liquidity were not implemented or tested. The local budget caps MPP charges; it does not cap additional source network fees. Unknown payment outcomes deliberately stop for inspection rather than retrying payment.
