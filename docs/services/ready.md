# Prepared funding

get the wallet ready for the work.

`ready` estimates a prepared transaction list and funds its native shortfall from Tempo. It never signs or submits those destination transactions.

## Set up

Save the prepared calls as `transactions.json`. Omit `to` for contract creation. `value` is decimal ETH; `data` is encoded calldata or creation bytecode.

```json
[{ "to": "YOUR_RECIPIENT", "value": "0", "data": "0x" }]
```

```sh
glue init ready --policy ready.local.json \
  --transactions transactions.json --recipient YOUR_DEPLOYER --chain base \
  --token usdc.e --amount 0.05 --max-spend 1 --fee-reserve 0.03 --duration 1h

glue run --policy ready.local.json
glue install release --policy ready.local.json --accept-network-fees --approve
```

`--amount` caps a single refill; `--max-spend` caps all refill charges. Tempo approves the total plus fee headroom. The transaction list is copied into the policy, so editing its original file cannot silently change an approved job.

## What happens

Glue estimates native transaction value plus gas, including L1 data and operator fees on Base/Optimism. A configurable 20% gas margin (`--margin-bps 2000`) allows for fee movement while gas arrives. It checks the wallet balance, requests a bounded quote for a shortfall, then follows delivery before considering another payment.

`ready` means funding covered the estimate at the reported time. Fees and chain state can change. The complete sequence is simulated against one mainnet block, carrying earlier calls’ state and nonces into later calls. The RPC must support `eth_simulateV1`; Glue stops if simulation fails or a call reverts. Outgoing native values are reserved conservatively, without assuming later refunds. Readiness is not permission to execute or a guarantee of future success.

```sh
glue status release
glue logs release
glue stop release
```

Stop when the release finishes. [Operations](../operations.md) covers expiry, recovery and uninstalling. The computer must be awake and online.
