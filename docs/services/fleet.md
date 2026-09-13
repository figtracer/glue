# Fleet funding

one budget. fund the workers that need it.

`fleet` coordinates native gas for existing wallets. It does not create wallets or need their signing keys.

## Set up

Save `wallets.json`:

```json
[
  {
    "chain": "base",
    "recipient": "WORKER_A",
    "belowEth": "0.000002",
    "active": true,
    "priority": 2
  },
  {
    "chain": "optimism",
    "recipient": "WORKER_B",
    "belowEth": "0.000002",
    "active": true,
    "priority": 1
  },
  {
    "chain": "arbitrum",
    "recipient": "WORKER_C",
    "belowEth": "0.000002",
    "active": false,
    "priority": 0
  }
]
```

Replace the recipient placeholders with wallet addresses. Higher priority goes first; file order breaks ties. Activity is explicit: your agent marks workers active or retired. Glue does not guess from old transactions.

```sh
glue init fleet --policy fleet.local.json --wallets wallets.json \
  --token usdc.e --amount 0.05 --max-spend 2 --fee-reserve 0.05 --duration 1h

glue run --policy fleet.local.json
glue install workers --policy fleet.local.json --accept-network-fees --approve
```

`--amount` caps each refill. All members share the same cumulative `--max-spend` budget and Tempo grant. One member's pending payment blocks further funding until its delivery is resolved. Existing balances count toward the target; inactive or retired wallets receive nothing new.

## Change activity

```sh
glue retire workers --recipient WORKER_A --chain base
glue activate workers --recipient WORKER_C --chain arbitrum
glue status workers
glue logs workers
```

These commands only select among already configured wallets. They never enlarge the budget or renew authority. Retirement does not cancel a payment already submitted; Glue still reconciles it. Adding destinations or changing funding targets requires a new job and approval.

Keep one funding owner per wallet and chain. Installation rejects overlapping installed jobs. [Operations](../operations.md) covers stop, restart, expiry and recovery.
