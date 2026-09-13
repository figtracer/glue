# Current services

small things you can use today. pick one and go.

Run `glue services` to browse or `glue services --json` from an agent. Discovery is local: it does not connect a wallet, create a job, or enable anything.

| Service                         | Use it for                       | Runs through                     | Start here                 |
| ------------------------------- | -------------------------------- | -------------------------------- | -------------------------- |
| **Refill** · `refill`           | Keep wallets ready automatically | Local launchd or systemd service | [Set up refill](refill.md) |
| **On-demand refuel** · `refuel` | Get gas immediately              | Website or MPP API               | [Use refuel](refuel.md)    |

`refill` has four setup modes:

| Mode          | Select it with                                          | `--amount` means          |
| ------------- | ------------------------------------------------------- | ------------------------- |
| One wallet    | `--chain CHAIN --recipient ADDRESS`                     | Fixed source-token charge |
| Fleet         | `--wallets FILE`                                        | Maximum input per refill  |
| Prepared work | `--transactions FILE --chain CHAIN --recipient ADDRESS` | Maximum input per refill  |
| Tempo token   | `--chain tempo --receive-token TOKEN --target AMOUNT`   | Maximum input per swap    |

All payments use the user's existing Tempo mainnet wallet. Native gas currently routes through Glue/Relay; Tempo token swaps execute directly on Tempo. Glue charges no fee or subscription. Network and upstream provider costs still apply.

## Manage a local job

```sh
glue list --json
glue status NAME
glue logs NAME
glue stop NAME
glue start NAME
glue uninstall NAME
```

Stop and uninstall preserve payment history and authority. Starting again does not renew a grant or reset its budget. Read the [operating guide](../operations.md) for expiry and recovery.
