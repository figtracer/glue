# Gas maintenance

watch gas. refill when needed.

|           |                                                    |
| --------- | -------------------------------------------------- |
| Service   | `gas`                                              |
| Runs      | Locally on macOS or Linux, after installation      |
| Watches   | Native ETH on Base, Ethereum, Arbitrum or Optimism |
| Pays with | pathUSD or USDC.e on Tempo mainnet                 |
| Trigger   | Balance falls below your ETH threshold             |
| Action    | Buy a fixed amount of gas, then confirm delivery   |

## Enable

[Install the CLI](../../README.md#getting-started) first. You need a [Tempo Wallet](https://wallet.tempo.xyz/) and a working user scheduler: launchd on macOS or systemd on Linux.

Create a job, replacing the wallet placeholders:

```sh
glue init --policy .glue/base.local.json \
  --sender YOUR_TEMPO_WALLET --recipient YOUR_BASE_WALLET \
  --chain base \
  --below-eth 0.00002 --amount 0.05 --min-receive-eth 0.000001 \
  --max-spend 0.25 --fee-reserve 0.01 --duration 30m --token pathusd
```

This example spends 0.05 pathUSD per refill when Base ETH is below 0.00002, with a 0.25 total refill budget. Amounts are examples; provider minimums and gas costs vary.

Check the balance or preview a quote without paying:

```sh
glue run --policy .glue/base.local.json
```

Enable scheduled refills:

```sh
glue install gas --policy .glue/base.local.json --accept-network-fees --approve
```

Tempo Wallet opens for passkey approval. This example requests one **0.26 pathUSD allowance** for refills and network fees, expiring 30 minutes after the approval request. The 0.01 fee reserve is headroom, not a fee quote. Tempo owns that limit and expiry.

An existing usable grant is reused. Glue never renews it in the background. One local `gas` service can be installed at a time.

## What happens next

Every 60 seconds by default, Glue checks the wallet. At or above the threshold, it does nothing. Below it, Glue checks a quote and its minimum output, rechecks balance and authority, then pays once. Later ticks confirm delivery before another refill can happen. The default cooldown after delivery is five minutes.

The refill buys a fixed source-token amount of gas; it does not target an exact final ETH balance. The computer must be awake, online and running your user scheduler.

## Manage

| Command              | Effect                                       |
| -------------------- | -------------------------------------------- |
| `glue status`        | See the job, latest result and grant         |
| `glue logs gas`      | Read recent check and payment events         |
| `glue stop gas`      | Stop scheduling                              |
| `glue start gas`     | Resume the same job                          |
| `glue uninstall gas` | Remove scheduling and retain payment history |

Expiry or budget exhaustion stops new payments. The service may remain installed, reporting that it cannot spend. Starting or reinstalling never resets the budget. See [budgets, renewal and recovery](../operations.md) before enabling a new job.

For a foreground worker, use `glue run --policy FILE --execute --accept-network-fees --watch` instead of installing.

[← Current services](README.md)
