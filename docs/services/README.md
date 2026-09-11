# Current services

small things you can use today. pick one, configure it, and go.

| Service                     | Use it for                                   | Runs through                     | Start here                              |
| --------------------------- | -------------------------------------------- | -------------------------------- | --------------------------------------- |
| **Gas maintenance** · `gas` | Keep a wallet ready for its next transaction | Local launchd or systemd service | [Enable gas maintenance](gas.md#enable) |
| **On-demand refuel**        | Get gas now, from a browser or an agent      | Website or MPP API               | [Use refuel](refuel.md)                 |

Both pay from Tempo mainnet with pathUSD or USDC.e. You choose the destination wallet and chain. Gas maintenance adds recurring balance checks; on-demand refuel handles a single request.

## Local services

Local services use a configured job and a Tempo grant. Once gas maintenance is installed, manage it with:

```sh
glue status
glue logs gas
glue stop gas
glue start gas
glue uninstall gas
```

Tempo owns spending authority and expiry. Glue handles the schedule, threshold checks and delivery. Stop or uninstall preserves the job's payment history; starting again does not renew a grant or reset its budget.

Read the [operating guide](../operations.md) for recovery and renewal. Services we might build next live in [ideas](../ideas.md).
