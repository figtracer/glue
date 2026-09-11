# Using glue

Small services using Tempo. Start with `glue services --json`; follow the linked [gas setup](docs/services/gas.md) or [MPP instructions](https://glue.figtracer.com/llms.txt). Use `glue COMMAND --help` for flags.

## Before enabling

- Read `glue status --json` and `glue logs gas`. Reuse an existing job and its state; do not install a second executor.
- Use the user's destination, token, threshold, refill amount, minimum output, budget, fee reserve and duration. Ask for missing spending choices. Examples are not authorization.
- `init` can read the sender from an existing Tempo CLI login. `run` previews without paying; `authorize` previews the grant. `install gas --policy FILE --accept-network-fees --approve` enables the service after Tempo approval.
- Reuse approvals already given. Never enlarge or renew authority without authorization. Never request wallet secrets in chat.

## While running

Tempo owns the grant expiry and combined token allowance. Glue enforces the destination, threshold and refill budget. See [authority and budgets](docs/operations.md#budget-and-expiry).

Use `status --json` for full state and live authority, or `status --policy FILE --json` for a specific job. Human status is concise text; scripts must request JSON. An installed timer does not imply usable authority. Report delivery only when confirmed.

Stop with `glue stop gas`; resume with `glue start gas`. Uninstall preserves history and does not revoke the Tempo key. The machine must stay awake and online.

## Recovery

Keep policy, state, credentials and receipts. Never delete state, edit the budget or copy a job to retry. Reconcile pending payments using the original policy and runtime overrides before considering another job. `payment_unknown` and `needs_attention` require inspection, not another payment.

Follow [recovery](docs/operations.md#state-and-recovery) for interrupted approvals or stale locks. Development guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md).
