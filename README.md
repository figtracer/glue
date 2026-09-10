# glue

Small agent services for getting funds where they're needed. A pre-Tempo playground; gas refill is the first service. Uses [Glue's MPP API](https://glue.figtracer.com/llms.txt) and your existing Tempo Wallet. No npm dependencies.

## Try it

Requires Node >=22.13 and a configured [Tempo Wallet CLI](https://tempo.xyz/). Nothing installs a daemon, creates a key or starts spending automatically.

```sh
npm test
npm link
# Or use node src/cli.mjs instead of glue.

glue init --policy .glue/base.local.json \
  --sender YOUR_TEMPO_WALLET --recipient YOUR_BASE_WALLET \
  --chain base --token pathusd \
  --below-eth 0.00002 --amount 0.05 --min-receive-eth 0.000001 \
  --max-spend 0.25 --expires-at YOUR_FUTURE_UTC_TIMESTAMP

glue run --policy .glue/base.local.json
```

Replace the wallet and timestamp placeholders. `expires-at` must be a future ISO timestamp ending in `Z`. This creates a policy and previews a quote, without paying. The numbers are examples, not guaranteed provider minimums or suitable thresholds for every chain.

To authorize execution under that policy:

```sh
glue run --policy .glue/base.local.json --execute --accept-network-fees --watch
```

It checks every 60 seconds by default. Without `--watch`, it checks once and exits. Run again to reconcile an existing payment; that does not require `--execute`. Stop a foreground watcher with Ctrl-C. After stopping it, `glue pause --policy FILE` persistently disables new refills. `glue status --policy FILE` shows the policy, budget reservations, pending order and receipts.

The first version spends a fixed `amount` when native ETH is below `belowEth`. It does not target a USD balance or promise a fixed number of transactions. `minReceiveEth` rejects poor quotes. Native ETH threshold checks use exact integer arithmetic. Supported mainnets: Base, Ethereum, Arbitrum, Optimism. Tokens: `pathusd`, `usdc.e`. Sepolia remains available in the existing Glue website/API, but is outside this worker's first scope.

## Budget and authority

- `maxSpend` caps cumulative **MPP token charges**, not additional Tempo network fees. `--accept-network-fees` acknowledges that distinction. The prototype does not promise an all-in fee cap.
- `expiresAt` stops initiating payments; paid orders continue through reconciliation. A process timeout cannot revoke an already-signed transaction. Use a suitably limited/expiring Tempo Wallet key too.
- `--execute` is a local opt-in. The worker uses your existing wallet key; it does not create a scoped key, request Touch ID/VK approval, or offer a tamper-resistant approval system. Local budgets depend on preserving the state and running this code.
- Glue is the trusted quote/fulfillment provider. MPP payees can vary by order. General signer-enforced recurring mandates and VK integration are future work, not a property of this CLI.
- Budget is reserved durably before payment. Unknown or failed payments never trigger another payment automatically. Refunds retain their budget reservation and require attention.

## State and recovery

State defaults to `~/.local/state/glue/<policy-path-id>/`. It is tied to the policy's canonical path and content hash. Do not delete it, copy a policy to reset limits, or run the same rule on multiple machines. Changed policy content is rejected once state exists. A fresh policy is a new allowance, not an extension of the old one.

One worker holds a filesystem lock. After a hard crash, inspect the PID in `run.lock`; only after confirming it exited, remove that lock file and resume with the original policy. Never remove `state.json` to retry a payment. Files are private and state writes are synced before payment submission.

For ambiguous outcomes, the worker asks Glue about the exact saved order. If Glue still reports unpaid, it stops with `payment_unknown`; inspect Tempo Wallet and the saved order. It cannot recover a client credential lost before Glue received it. This conservative stop sacrifices availability to avoid paying twice.

Useful overrides: `--rpc URL`, `--api URL`, `--tempo /path/to/tempo`, `--state-dir DIR`. Use overrides consistently. HTTPS is required except for loopback integration tests; redirects are rejected. RPC chain IDs are checked. Provider/RPC outages stop the current run with an error; an external scheduler can retry the same command/state. The default cooldown is five minutes after delivery to avoid rapid repeated refills. Polling/cooldown can be configured at init, with a 30-second minimum.

No background task is installed. For cron, invoke the one-shot `run` with the same policy/state; do not also run `--watch`. If a laptop sleeps, the worker evaluates the current balance when it resumes; it does not replay missed refills.

## Development

```sh
npm run check
npm test
```

Tests cover the actual executable with a local RPC/Glue/Tempo stub, alongside budget, expiry, receipt and failure-state tests. See [validation](docs/validation.md) for the live test record.

[Brainstorm and direction](docs/ideas.md): human-approved routines, gas/deployment readiness, future services and replaceable fulfillment routes. This repo is **glue**, not an ensure-only product or an official Tempo binary feature.
