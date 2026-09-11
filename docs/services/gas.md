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

Create a job with your destination and spending limits:

```sh
glue init --policy .glue/base.local.json \
  --recipient YOUR_BASE_WALLET \
  --chain base \
  --below-eth 0.00002 --amount 0.05 --min-receive-eth 0.000001 \
  --max-spend 0.25 --fee-reserve 0.01 --duration 30m --token pathusd
```

Sender is read from the existing Tempo CLI login (`~/.tempo/bin/tempo`). If unavailable, supply `--sender ADDRESS`. No login or approval opens during setup.

This example spends 0.05 pathUSD per refill when Base ETH is below 0.00002, with a 0.25 total refill budget. Amounts are examples; provider minimums and gas costs vary.

Check the balance or preview a quote without paying:

```sh
glue run --policy .glue/base.local.json
```

Enable scheduled refills:

```sh
glue install gas --policy .glue/base.local.json --accept-network-fees --approve
```

Approve the 0.26 pathUSD allowance in Tempo Wallet: 0.25 for refills plus 0.01 network-fee headroom, valid for 30 minutes from the request. Existing usable grants are reused. See [budget and expiry](../operations.md#budget-and-expiry).

## What happens next

Every 60 seconds by default, Glue checks the wallet. At or above the threshold, it does nothing. Below it, Glue checks a quote and its minimum output, rechecks balance and authority, then pays once. Later ticks confirm delivery before another refill can happen. The default cooldown after delivery is five minutes.

The refill buys a fixed source-token amount of gas; it does not target an exact final ETH balance. The computer must be awake, online and running your user scheduler.

## Manage

`glue status` shows balance, remaining Tempo allowance, expiry and pending delivery. Add `--json` for the full record. `glue logs gas` shows recent events.

Use `glue stop gas`, `glue start gas` or `glue uninstall gas`. These preserve payment history and never renew authority. One local service can be installed; keep the computer awake and online.

See [operations](../operations.md) for recovery and foreground execution.
