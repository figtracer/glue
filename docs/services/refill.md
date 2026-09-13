# Refill

keep a wallet ready. one setup command, four modes.

`glue init refill` maintains native gas for one wallet or a fleet, funds the native shortfall for prepared work, or maintains pathUSD/USDC.e on Tempo. The options select exactly one mode.

## One wallet

```sh
glue init refill --policy base.local.json \
  --recipient YOUR_WALLET --chain base \
  --below-eth 0.00002 --min-receive-eth 0.000001 \
  --token pathusd --amount 0.05 --max-spend 0.25 \
  --fee-reserve 0.01 --duration 30m
```

Glue checks native ETH and buys a fixed source-token amount when the balance is below the threshold. It does not target an exact final ETH balance.

## Fleet

Save the existing wallets in `wallets.json`:

```json
[
  {
    "chain": "base",
    "recipient": "WORKER_ADDRESS",
    "belowEth": "0.000002",
    "active": true,
    "priority": 1
  }
]
```

```sh
glue init refill --policy fleet.local.json --wallets wallets.json \
  --token usdc.e --amount 0.05 --max-spend 1 \
  --fee-reserve 0.03 --duration 1h
```

One grant and cumulative budget cover the fleet. `--amount` caps each refill. Active wallets are funded by priority. `glue retire` and `glue activate` only select wallets already in the policy.

## Prepared work

Save the unsigned calls in `transactions.json`. Glue simulates the sequence and funds its native gas and value shortfall, up to `--amount` per refill. It never submits the prepared work. Stop the job when the work finishes.

```sh
glue init refill --policy deploy.local.json \
  --transactions transactions.json --recipient YOUR_DEPLOYER --chain base \
  --token usdc.e --amount 0.05 --max-spend 1 \
  --fee-reserve 0.03 --duration 1h
```

## Tempo payment token

```sh
glue init refill --policy payments.local.json --chain tempo \
  --token usdc.e --receive-token pathusd --target 0.10 \
  --amount 0.15 --max-spend 1 --fee-reserve 0.03 --duration 1h
```

Glue swaps only the missing amount through Tempo's stablecoin DEX. `--amount` caps one swap's input. The default slippage bound is 50 basis points and can be changed with `--slippage-bps`, up to 100.

## Preview and enable

Every mode uses the same lifecycle:

```sh
glue run --policy JOB.local.json
glue install NAME --policy JOB.local.json --accept-network-fees --approve
glue status NAME
glue logs NAME
```

Tempo owns the token allowance and expiry. Glue keeps the destination, threshold and cumulative budget in the saved job. Stop, restart and uninstall preserve authority, receipts and spending history. The machine must stay awake and online.

Existing `gas`, `ready`, `fleet` and `reserve` policies and setup scripts remain compatible. New `refill` jobs use those internal policy kinds too, so their saved records may show an older name. Reuse saved jobs rather than recreating them.

[Operations and recovery →](../operations.md)
