# Running glue

`glue run --policy FILE` previews a quote or reconciles an existing payment. Add `--execute --accept-network-fees` to pay, and `--watch` to keep checking. Stop a watcher with Ctrl-C before running `glue pause --policy FILE`. `glue status --policy FILE` shows the saved policy and receipts.

## Budget and authority

- `maxSpend` caps cumulative **MPP token charges**, not additional Tempo network fees. `--accept-network-fees` acknowledges that distinction. The prototype does not promise an all-in fee cap.
- `expiresAt` stops initiating payments; paid orders continue through reconciliation. A process timeout cannot revoke an already-signed transaction. Use a suitably limited/expiring Tempo Wallet key too.
- `--execute` is a local opt-in. The worker uses your existing wallet key; Passkey approval is handled by Tempo Wallet through `glue authorize --approve`. Glue does not create a dedicated key or offer a tamper-resistant policy system. Local budgets depend on preserving the state and running this code.
- Glue is the trusted quote/fulfillment provider. MPP payees can vary by order. General signer-enforced recurring mandates and VK integration are future work, not a property of this CLI.
- Budget is reserved durably before payment. Unknown or failed payments never trigger another payment automatically. Refunds retain their budget reservation and require attention.

## State and recovery

State defaults to `~/.local/state/glue/<policy-path-id>/`. It is tied to the policy's canonical path and content hash. Do not delete it, copy a policy to reset limits, or run the same rule on multiple machines. Changed policy content is rejected once state exists. A fresh policy is a new allowance, not an extension of the old one.

One worker holds a filesystem lock. After a hard crash, inspect the PID in `run.lock`; only after confirming it exited, remove that lock file and resume with the original policy. Never remove `state.json` to retry a payment. Files are private and state writes are synced before payment submission.

For ambiguous outcomes, the worker asks Glue about the exact saved order. If Glue still reports unpaid, it stops with `payment_unknown`; inspect Tempo Wallet and the saved order. It cannot recover a client credential lost before Glue received it. This conservative stop sacrifices availability to avoid paying twice.

Useful overrides: `--rpc URL`, `--api URL`, `--tempo /path/to/tempo`, `--state-dir DIR`. Use overrides consistently. HTTPS is required except for loopback integration tests; redirects are rejected. RPC chain IDs are checked. Provider/RPC outages stop the current run with an error; an external scheduler can retry the same command/state. The default cooldown is five minutes after delivery to avoid rapid repeated refills. Polling/cooldown can be configured at init, with a 30-second minimum.

No background task is installed. For cron, invoke the one-shot `run` with the same policy/state; do not also run `--watch`. If a laptop sleeps, the worker evaluates the current balance when it resumes; it does not replay missed refills.

## Passkey approval

`glue authorize --policy FILE` previews the remaining charge allowance. Add `--approve` to open Tempo Wallet's first-party passkey flow. This replaces the selected token's allowance on the currently connected key; other applications share that allowance. It does not sign the destination, threshold or full Glue policy onchain. Keep a dedicated, suitably limited Tempo Wallet key for unattended jobs.

The worker records the selected key and refuses new execution without completed authorization. It checks wallet identity, source network, key expiry and the selected token's finite, nonrecurring limit before payment. An unavailable remaining-limit field is not treated as a balance: Glue's durable ledger still governs cumulative charges. Network fees remain additional. The Tempo CLI selects the signing key; do not change its login while a worker runs. These local identity checks cannot isolate the wallet from another local process.

The installed Tempo CLI cannot set a key's expiry through `keys update`. Glue stops at the earlier of the policy deadline and the recorded key expiry, but this does not shorten or revoke the key onchain. An expired or changed key stops new payments; existing submissions still reconcile.

Repeating `authorize` never replenishes an allowance. A successful update followed by a temporary wallet-read failure can finish verification on the next invocation. Cancellation, timeout or a crash before recording success leaves an unresolved attempt and blocks execution. Inspect Tempo Wallet; do not delete the ledger or recreate a policy to retry. Pausing Glue does not revoke the shared key.
