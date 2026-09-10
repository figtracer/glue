# Running glue

`glue run --policy FILE` previews a quote or reconciles an existing payment. Add `--execute --accept-network-fees` to pay, and `--watch` to keep checking. Stop a watcher with Ctrl-C before running `glue pause --policy FILE`. `glue status --policy FILE` shows the saved policy and receipts.

## Budget and authority

`glue authorize --policy FILE --approve` opens Tempo Wallet's passkey flow for a dedicated key. The requested duration becomes the key's native expiry. Glue reads the signed grant before publication and queries the Tempo keychain once published. There is no separate Glue deadline. `glue status` shows the grant expiry and remaining time.

The key is limited to the selected token and its transfer methods. The SDK stores it privately in the job's state directory, separately from your usual Tempo CLI wallet. MPP signing explicitly selects this key. Glue never asks for your passkey or copies your existing wallet key.

`maxSpend` requests a finite Tempo token allowance and bounds Glue's cumulative MPP charges. Network fees are additional; `--accept-network-fees` acknowledges this. Destination, threshold and route checks remain Glue's job logic. Do not treat those fields as onchain permissions.

Budget is reserved durably before signing. Unknown submissions never initiate another payment. Paid orders continue through reconciliation after key expiry or revocation. Pausing Glue stops new jobs; revoke its dedicated key in Tempo Wallet to remove signing authority.

## State and recovery

State defaults to `~/.local/state/glue/<policy-path-id>/`. It is tied to the policy's canonical path and content hash. Do not delete it, copy a policy to reset limits, or run the same rule on multiple machines. Changed policy content is rejected once state exists. A fresh policy is a new allowance, not an extension of the old one.

One worker holds a filesystem lock. After a hard crash, inspect the PID in `run.lock`; only after confirming it exited, remove that lock file and resume with the original policy. Never remove `state.json` to retry a payment. Files are private and state writes are synced before payment submission.

For ambiguous outcomes, the worker asks Glue about the exact saved order. If Glue still reports unpaid, it stops with `payment_unknown`; inspect Tempo Wallet and the saved order. A signed credential is saved before submission; this version still requires manual inspection when delivery is uncertain. This conservative stop sacrifices availability to avoid paying twice.

Useful overrides: `--rpc URL`, `--api URL`, `--state-dir DIR`. Use overrides consistently. HTTPS is required except for loopback integration tests; redirects are rejected. RPC chain IDs are checked. Provider/RPC outages stop the current run with an error; an external scheduler can retry the same command/state. The default cooldown is five minutes after delivery to avoid rapid repeated refills. Polling/cooldown can be configured at init, with a 30-second minimum.

No background task is installed. For cron, invoke the one-shot `run` with the same policy/state; do not also run `--watch`. If a laptop sleeps, the worker evaluates the current balance when it resumes; it does not replay missed refills.

## Approval recovery

`authorize` without `--approve` previews a new grant. Once an attempt exists, repeating the command only looks for its saved signed grant; it never renews a key or replenishes an allowance. Interrupted approvals without a saved grant remain unresolved. Keep the state and inspect Tempo Wallet instead of deleting files to retry.

Version 1 jobs retain their original state and can reconcile existing payments. New grants use version 2 jobs with `--duration`; a new job is a new allowance, so stop the previous worker first.
