# Using glue

Small funding services using your existing Tempo wallet. Start with `glue services --json`; choose [gas](docs/services/gas.md), [prepared funding](docs/services/ready.md), [fleet](docs/services/fleet.md), [token reserve](docs/services/reserve.md), or [MPP instructions](https://glue.figtracer.com/llms.txt). Use `glue COMMAND --help` for flags.

## Before enabling

- Read `glue status NAME --json` and `glue logs NAME`. Reuse an existing job and its state; do not install a second executor.
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

## Choosing a service

- `ready`: prepare a transaction sequence, configure their deployer/chain, then stop the service when the work ends. Glue never submits the prepared work.
- `fleet`: configure recipients, targets and priorities once. Use `retire NAME --recipient ADDRESS --chain CHAIN` or `activate` as workers finish/start. One grant and budget cover the fleet.
- `reserve`: choose input/output Tempo tokens and a target wallet balance. Preview the exact-output swap; approve the DEX-specific grant to enable it.

Use `glue init SERVICE --help`. Policies snapshot their input files; do not edit approved policies to change destinations, amounts or authority. Preserve pending state across restarts. A scheduled job needs an awake, online computer. Never claim guaranteed delivery time or cheaper execution than another provider without measurements.
