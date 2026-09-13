# Using glue

Small funding services using the user's existing Tempo wallet. Start with `glue services --json`; choose local [refill](docs/services/refill.md) or the [MPP instructions](https://glue.figtracer.com/llms.txt) for an immediate refill. Use `glue COMMAND --help` for flags.

## Before enabling

- Run `glue list --json` to find saved jobs, then read `glue status NAME --json` and `glue logs NAME`. Reuse an existing job and its state; do not install a second executor.
- Use the user's destination, token, threshold, refill amount, minimum output, budget, fee reserve and duration. Ask for missing spending choices. Examples are not authorization.
- `init` can read the sender from an existing Tempo CLI login. `run` previews without paying; `authorize` previews the grant. `install NAME --policy FILE --accept-network-fees --approve` enables the service after Tempo approval.
- Reuse approvals already given. Never enlarge or renew authority without authorization. Never request wallet secrets in chat.

## While running

Tempo owns the grant expiry and combined token allowance. Glue enforces the destination, threshold and refill budget. See [authority and budgets](docs/operations.md#budget-and-expiry).

Use `status --json` for full state and live authority, or `status --policy FILE --json` for a specific job. Human status is concise text; scripts must request JSON. An installed timer does not imply usable authority. Report delivery only when confirmed.

Stop with `glue stop NAME`; resume with `glue start NAME`. Uninstall preserves history and does not revoke the Tempo key. The machine must stay awake and online.

## Recovery

Keep policy, state, credentials and receipts. Never delete state, edit the budget or copy a job to retry. Reconcile pending payments using the original policy and runtime overrides before considering another job. `payment_unknown` and `needs_attention` require inspection, not another payment.

Follow [recovery](docs/operations.md#state-and-recovery) for interrupted approvals or stale locks. Development guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md).

## Choosing a refill mode

- One wallet: supply `--chain`, `--recipient`, `--below-eth` and `--min-receive-eth`.
- Fleet: supply `--wallets FILE`. Use `retire NAME --recipient ADDRESS --chain CHAIN` or `activate` as workers finish or start. One grant and budget cover the fleet.
- Prepared work: supply `--transactions FILE`, `--chain` and `--recipient`. Glue funds the estimated shortfall and never submits the prepared work. Stop the job when the work ends.
- Tempo token: supply `--chain tempo`, `--receive-token` and `--target`. Glue swaps the shortfall and uses a DEX-specific grant.

Use `glue init refill --help`. The options select the mode; do not combine mode selectors. Policies snapshot their input files, and saved jobs may still identify their internal kind as `gas`, `ready`, `fleet` or `reserve`. Do not edit approved policies to change destinations, amounts or authority. Preserve pending state across restarts. A scheduled job needs an awake, online computer. Never claim guaranteed delivery time or cheaper execution than another provider without measurements.
