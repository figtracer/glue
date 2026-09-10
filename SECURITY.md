# Security

Glue moves funds. Treat this prototype accordingly.

Report suspected vulnerabilities privately to the maintainer at **me@figtracer.com**. Include a minimal reproduction and affected commit. Do not post keys, credentials, payment artifacts or a funded-wallet reproduction in an issue. There is no promised response time or bounty program.

## Boundaries

The current worker trusts Glue's quote/fulfillment API and the dedicated key approved in Tempo Wallet. Tempo Wallet handles passkey approval of the dedicated key allowance and expiry. Local policy files are not an onchain permission boundary. `maxSpend` bounds MPP charges; `feeReserve` adds headroom to the same Tempo allowance for source network fees. Tempo enforces their combined token limit. See [operations](docs/operations.md).

The installed service runs as the local user and reuses the same job state on every tick. Stop and uninstall remove scheduling, not wallet authority or payment history. Revoke the dedicated key in Tempo Wallet to remove its authority. Anyone controlling the local account can access its saved SDK key; protect that account and state directory.

Uncertain submissions must remain pending. Do not initiate another payment to recover from a timeout. Never reset a user's saved state, broaden wallet permissions or perform a live payment without explicit authorization.

CI uses mock payments, read-only tokens and no wallet secrets. Runtime policies, receipts, environment files and credentials must stay untracked. Only the current main branch receives fixes during this prototype stage.
