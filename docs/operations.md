# Running glue

`glue run --policy FILE` previews a quote or reconciles an existing payment. Add `--execute --accept-network-fees` to pay, and `--watch` to keep checking. Stop a watcher with Ctrl-C before running `glue pause --policy FILE`. `glue status --policy FILE` shows the saved policy and receipts.

## Local service

Create a policy with `glue init`, then run:

```sh
glue install gas --policy .glue/base.local.json --accept-network-fees --approve
glue status
glue logs gas
```

Install opens Tempo Wallet only when the job needs its first grant and `--approve` is supplied. Without that flag it previews the grant and installs nothing. An existing grant is reused without another passkey prompt. There is no automatic renewal.

Glue installs one `gas` service for your user account. [launchd](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5) handles macOS; a [systemd user timer](https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml) handles Linux. Each scheduled process runs one check using the existing policy and payment journal, then exits. The interval comes from `intervalSeconds` (60 seconds by default). Missed checks are not replayed. Sleeping or offline computers cannot keep a wallet funded continuously; the next scheduled run checks the current balance. Linux requires a running systemd user manager; Glue does not enable lingering or require root.

`glue stop gas` disables scheduling and stops the scheduled process. `glue start gas` resumes the same installed job. `glue uninstall gas` also removes its scheduler files. These commands preserve the grant, journal, logs and receipts. They do not revoke the Tempo key or stop a separately launched foreground worker. Do not run `--watch` alongside the installed service.

`glue status` reports scheduling, the configured threshold and refill, the last outcome, any job lock, and the native grant expiry and remaining allowance. `glue logs gas` returns the latest 100 compact events. Service metadata and logs live in `~/.local/state/glue/services/gas/`; payment state stays in its original directory. Runtime overrides supplied during installation are saved, so future ticks use the same API, RPC and state directory.

Keep the checkout and Node installation used to install the service available. After moving the checkout or upgrading Node, stop and start the service from the working CLI to refresh the native command. Native files are `~/Library/LaunchAgents/com.figtracer.glue.gas.plist` on macOS and `~/.config/systemd/user/com.figtracer.glue.gas.{service,timer}` on Linux.

Expiry or budget exhaustion prevents further payments. Pending payments still reconcile. To enable a new grant, stop and uninstall the old service, resolve any pending payment, then explicitly create and install a new policy. Reinstalling the same policy never resets its budget. Missing or changed payment state is an error, not permission to start over.

## Budget and authority

`glue authorize --policy FILE --approve` opens Tempo Wallet's passkey flow for a dedicated key. The requested duration becomes the key's native expiry. Glue reads the signed grant before publication and queries the Tempo keychain once published. There is no separate Glue deadline. `glue status` shows the grant expiry and remaining time.

The key is limited to the selected token and its transfer methods. The SDK stores it privately in the job's state directory, separately from your usual Tempo CLI wallet. MPP signing explicitly selects this key. Glue never asks for your passkey or copies your existing wallet key.

`maxSpend` bounds Glue's cumulative MPP charges. `--fee-reserve` explicitly adds headroom for network fees to the same Tempo token allowance. For example, a 0.05 refill budget and 0.01 reserve request a 0.06 native limit. Tempo counts both transfers and network fees against that combined limit, including fees from reverted transactions. There is no separate onchain fee bucket: fees can consume the remaining allowance and stop refills early. The reserve is not an estimate or a guarantee of enough gas. `--accept-network-fees` acknowledges the additional cost. Destination, threshold and route checks remain Glue's job logic. Do not treat those fields as onchain permissions.

Budget is reserved durably before signing. Unknown submissions never initiate another payment. Paid orders continue through reconciliation after key expiry or revocation. Pausing Glue stops new jobs; revoke its dedicated key in Tempo Wallet to remove signing authority.

## State and recovery

State defaults to `~/.local/state/glue/<policy-path-id>/`. It is tied to the policy's canonical path and content hash. Do not delete it, copy a policy to reset limits, or run the same rule on multiple machines. Changed policy content is rejected once state exists. A fresh policy is a new allowance, not an extension of the old one.

One worker holds a filesystem lock. After a hard crash, inspect the PID in `run.lock`; only after confirming it exited, remove that lock file and resume with the original policy. Never remove `state.json` to retry a payment. Files are private and state writes are synced before payment submission.

For ambiguous outcomes, the worker asks Glue about the exact saved order. If Glue still reports unpaid, it stops with `payment_unknown`; inspect Tempo Wallet and the saved order. A signed credential is saved before submission; this version still requires manual inspection when delivery is uncertain. This conservative stop sacrifices availability to avoid paying twice.

Useful overrides: `--rpc URL`, `--api URL`, `--state-dir DIR`. Use overrides consistently. HTTPS is required except for loopback integration tests; redirects are rejected. RPC chain IDs are checked. Provider/RPC outages stop the current run with an error; an external scheduler can retry the same command/state. The default cooldown is five minutes after delivery to avoid rapid repeated refills. Polling/cooldown can be configured at init, with a 30-second minimum.

`run` alone installs no background task. To use an external scheduler instead of `glue install`, invoke the one-shot `run` with the same policy/state. Use only one scheduler for a job.

## Approval recovery

`authorize` without `--approve` previews a new grant. Once an attempt exists, repeating the command only looks for its saved signed grant; it never renews a key or replenishes an allowance. Interrupted approvals without a saved grant remain unresolved. Keep the state and inspect Tempo Wallet instead of deleting files to retry.

Existing jobs without a fee reserve keep their original grant and state; Glue never enlarges their allowance. A new grant requires an explicit fee reserve. If the remaining native allowance cannot cover a refill plus fees, execution stops before signing.

Version 1 jobs retain their original state and can reconcile existing payments. New grants use version 2 jobs with `--duration`; a new job is a new allowance, so stop the previous worker first.
