# Using glue

Use Glue to get gas for a wallet or keep it funded. Act within the user's requested destination, budget and duration. Tempo owns the wallet and payment authority; Glue handles the service.

## Choose a service

- **On-demand refuel:** use [llms.txt](https://glue.figtracer.com/llms.txt) for the current MPP instructions. Follow its request and delivery flow.
- **Gas maintenance:** install the local `gas` service using the [setup guide](docs/services/gas.md). It watches native ETH on Base, Ethereum, Arbitrum or Optimism and refills below a threshold.

The [services catalog](docs/services/README.md) lists what is available. Pay from Tempo mainnet with pathUSD or USDC.e. Local gas maintenance requires macOS or Linux with a working user scheduler.

## Before enabling payments

Use the wallet addresses, chain, source token, threshold, refill amount, minimum output, total charge budget, fee reserve and duration supplied by the user. Ask for missing spending choices; documentation examples are not authorization. Reuse choices and approvals already given for this job.

Check for an existing service first:

```sh
glue status
glue logs gas
```

If a job already exists, keep its policy and state directory. Inspect its grant, latest result and pending order before acting. Do not create a second job to work around an error or exhausted allowance.

## Enable gas maintenance

Create a policy with `glue init` as shown in the [setup guide](docs/services/gas.md#enable). Preview the balance or quote without paying:

```sh
glue run --policy FILE
glue authorize --policy FILE
```

When the user has authorized the job, enable it:

```sh
glue install gas --policy FILE --accept-network-fees --approve
```

The user completes the Tempo passkey approval when a new grant is needed. An existing usable grant is reused. Do not request passkeys, private keys or wallet credentials in chat.

`maxSpend` caps refill charges. `feeReserve` adds network-fee headroom to the same Tempo allowance; fees count against its combined limit. Tempo is the sole expiry authority. Do not extend the duration, enlarge the allowance or renew authority without the user's authorization.

One local `gas` service can be installed. Keep its checkout, Node installation and state available. The computer must be awake and online. Do not run a foreground watcher or another scheduler alongside it.

## Observe and manage

| Command                     | Use it to                                                        |
| --------------------------- | ---------------------------------------------------------------- |
| `glue status`               | Read scheduling, job configuration, last result and native grant |
| `glue logs gas`             | Read recent check and payment events                             |
| `glue status --policy FILE` | Inspect the full job state and receipts                          |
| `glue stop gas`             | Stop the local service                                           |
| `glue start gas`            | Resume the same job with existing authority                      |
| `glue uninstall gas`        | Remove scheduling while preserving payment history               |

Report delivery only after it is confirmed. `submitted` means the payment was submitted, not that gas arrived. An installed timer can still have an expired grant or exhausted budget. Report that condition; restarting does not restore spending authority.

Stop and uninstall do not revoke the Tempo key. If the user wants to revoke authority, direct them to the dedicated key in Tempo Wallet.

## Recover without paying twice

For a pending payment, run `glue run --policy FILE` with the original state and runtime overrides to reconcile the existing order. Do not initiate a replacement payment after a timeout, `payment_unknown` or `needs_attention` result.

Preserve policies, journals, credentials and receipts. Never delete state, copy a job or change its budget to make a retry succeed. Do not expose SDK stores or signed payment credentials in messages or logs. Missing state and unresolved outcomes require inspection, not a fresh allowance.

Read the [operating guide](docs/operations.md) for lock recovery and explicitly approved new jobs. Repository development guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md).
