# Current services

small things you can use today. pick one, configure it, and go.

Run `glue services` to browse, `glue services fleet` for a specific service, or `glue services --json` from an agent. Discovery reads the bundled catalog; it does not connect a wallet or install anything.

No Glue fees. Network and upstream provider costs still apply.

| Service                        | Use it for                                        | Runs through                     | Start here                              |
| ------------------------------ | ------------------------------------------------- | -------------------------------- | --------------------------------------- |
| **Gas maintenance** · `gas`    | Keep a wallet ready for its next transaction      | Local launchd or systemd service | [Enable gas maintenance](gas.md#enable) |
| **Prepared funding** · `ready` | Fund a prepared transaction list                  | Local service                    | [Set up](ready.md)                      |
| **Fleet funding** · `fleet`    | Keep active agent wallets funded under one budget | Local service                    | [Set up](fleet.md)                      |
| **Token reserve** · `reserve`  | Keep a payment token available on Tempo           | Local service                    | [Set up](reserve.md)                    |
| **On-demand refuel**           | Get gas now, from a browser or an agent           | Website or MPP API               | [Use refuel](refuel.md)                 |

All payments use your existing Tempo mainnet wallet. Gas services deliver native ETH through Glue/Relay. Token reserves swap directly on Tempo. Read-only discovery and configuration require no account or payment.

## Local services

Local services use a configured job and a Tempo grant. Give each installed job a name. For example, after installing a fleet as `workers`:

```sh
glue status workers
glue logs workers
glue stop workers
glue start workers
glue uninstall workers
```

Tempo owns spending authority and expiry. Glue handles the schedule, threshold checks and delivery. Stop or uninstall preserves the job's payment history; starting again does not renew a grant or reset its budget.

Read the [operating guide](../operations.md) for recovery and renewal. Services we might build next live in [ideas](../ideas.md).
