# Running glue

Create a job with `glue init`; the [README](../README.md#getting-started) has a Base example. Install one local `gas` service, or run the same worker in the foreground. Use one scheduler and one persistent state directory per job.

## Install and manage

```sh
glue install gas --policy .glue/base.local.json --accept-network-fees --approve
glue status
glue logs gas
```

For a job without a grant, `--approve` opens Tempo Wallet's passkey flow. Omit it to preview the required allowance without installing. If the job already has a usable grant, install reuses it and enables scheduling without another prompt. It never renews a grant.

Each scheduled process checks once, then exits. At or above `belowEth`, nothing is paid. Below it, Glue requests a fixed `amount` refill, checks the minimum output, rechecks the balance and authority, and submits once. Later ticks reconcile delivery before considering another refill. This buys a fixed amount of gas; it does not calculate an exact top-up to the threshold.

| Command                     | Effect                                                                |
| --------------------------- | --------------------------------------------------------------------- |
| `glue status`               | Scheduling, configured job, latest outcome, job lock and native grant |
| `glue logs gas`             | Latest 100 compact events                                             |
| `glue stop gas`             | Disable scheduling and stop its process                               |
| `glue start gas`            | Resume the installed job using existing authority                     |
| `glue uninstall gas`        | Stop scheduling and remove its native files                           |
| `glue status --policy FILE` | Full job state and saved receipts                                     |
| `glue run --policy FILE`    | Check/quote without paying, or reconcile a submitted payment          |

Stop and uninstall preserve the policy, Tempo key, payment journal, logs and receipts. They do not revoke the key or stop a separately launched foreground worker. Revoke the dedicated key in Tempo Wallet to remove its signing authority.

## Budget and expiry

| Init option          | Meaning                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `--below-eth`        | Native ETH balance that triggers a refill                          |
| `--amount`           | Source-token charge per refill                                     |
| `--min-receive-eth`  | Minimum acceptable ETH delivery in the quote                       |
| `--max-spend`        | Cumulative MPP charge budget, excluding source network fees        |
| `--fee-reserve`      | Extra token allowance requested for network fees                   |
| `--duration`         | Requested Tempo key lifetime, such as `30m`; accepts `s`, `m`, `h` |
| `--interval-seconds` | Time between checks; default 60                                    |
| `--cooldown-seconds` | Minimum delay after delivery before another refill; default 300    |

Source amounts use the selected token's six decimals; ETH amounts use 18. Durations must be at least 30 seconds. Interval and cooldown must be between 30 and 86400 seconds.

A 0.05 refill budget plus a 0.01 reserve requests a 0.06 Tempo allowance. Tempo counts transfers and network fees against that combined limit, including fees from reverted transactions. The reserve is headroom, not a fee quote or a separate onchain bucket. Fees can consume the remaining allowance and stop refills early. `--accept-network-fees` acknowledges their additional cost.

Your Tempo passkey approves a dedicated key limited to the selected token and its transfer methods. The official Accounts SDK stores it privately in the job's state directory. Glue reads the signed grant before publication and the Tempo keychain once published. Tempo is the sole expiry authority; Glue never extends that expiry in the background.

The destination, threshold and routing checks are Glue's job logic. They are not onchain permissions. Budget is reserved durably before signing, and refunds do not automatically replenish it.

## When a job stops paying

`glue status` separates whether the service is scheduled from whether the job can spend. A timer can remain installed after budget exhaustion or expiry.

| Latest outcome                        | Meaning                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `funded`                              | Balance is at or above the threshold                                                                  |
| `submitted` / `pending`               | Payment or delivery is still being reconciled                                                         |
| `delivered`                           | Delivery was confirmed                                                                                |
| `cooldown`                            | Too soon to refill after the last delivery                                                            |
| `budget_exhausted`                    | The next refill would exceed the charge budget                                                        |
| `busy`                                | Another worker holds the job lock; no second check runs                                               |
| `error`                               | Read the message; expired/revoked authority, insufficient allowance or an IO failure can stop a check |
| `payment_unknown` / `needs_attention` | Inspect the saved order before taking further action                                                  |

Overlapping ticks do not add log events; inspect the lock shown by `glue status` if checks appear stuck. Normal failures are logged. An expired or revoked key blocks new payments, while an already-submitted order can still reconcile. Neither `start` nor reinstalling the same job restores a spent budget.

To enable a new grant:

1. Stop and uninstall the old service.
2. Reconcile any pending payment with `glue run --policy OLD_FILE`, using its original state and overrides. Inspect unresolved outcomes before proceeding.
3. Create a new policy at a new path with the desired budget and duration.
4. Install that policy and approve the new Tempo grant.

Keep the old files. A new job is a new allowance, so create it deliberately; do not copy or edit an existing policy to retry a payment.

## State and recovery

Payment state defaults to `~/.local/state/glue/<policy-path-id>/`. It is bound to the policy's canonical path and content hash. Missing or changed installed state is an error, not permission to create a fresh budget.

Service metadata and bounded logs live in `~/.local/state/glue/services/gas/`. Runtime `--rpc`, `--api` and `--state-dir` overrides supplied at installation are saved for scheduled ticks. Pass the same overrides when operating directly on the policy with `run`, `authorize` or `status --policy`.

An unknown submission keeps its original order and reserved budget. Glue never signs another payment to recover from a timeout. If the provider still reports unpaid, the worker reports `payment_unknown`; inspect Tempo Wallet and the saved order. Credentials are saved privately before submission.

One worker holds `run.lock` in the payment state directory. Service-control commands use a separate lock in the service directory. After a hard crash, inspect the recorded PID; only after confirming that process exited, remove that lock file and resume. Never remove `state.json`, credentials or receipts to retry a payment.

Interrupted passkey approvals remain recorded. Repeating authorization looks for the saved signed grant; it does not open another ceremony or replenish authority. Keep the state and inspect Tempo Wallet if approval remains unresolved.

Older jobs retain their state. Version 1 jobs can reconcile payments; local services require version 2 with a native Tempo grant. Existing grants without fee reserves are never silently expanded.

## Local scheduling

[launchd](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5) handles macOS; a [systemd user timer](https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml) handles Linux. Linux requires a running user manager; Glue does not enable lingering or require root. Missed checks are not replayed. Sleeping or offline computers cannot guarantee a continuous gas reserve.

Keep the checkout and Node installation used by the service available. After moving the checkout or upgrading Node, stop and start from the working CLI to refresh the native command. The job still needs usable authority, unless it is reconciling an existing submission.

Native files:

- macOS: `~/Library/LaunchAgents/com.figtracer.glue.gas.plist`
- Linux: `~/.config/systemd/user/com.figtracer.glue.gas.service` and `.timer`

For a foreground worker, use `glue run --policy FILE --execute --accept-network-fees --watch`. For another scheduler, invoke the one-shot `run` with the same policy/state. Do not combine these with the installed service. `glue pause --policy FILE` stops new payments in the job itself; stop a foreground watcher before using it.
