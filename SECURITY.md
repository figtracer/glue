# Security

Glue moves funds. Treat this prototype accordingly.

Report suspected vulnerabilities privately to the maintainer at **me@figtracer.com**. Include a minimal reproduction and affected commit. Do not post keys, credentials, payment artifacts or a funded-wallet reproduction in an issue. There is no promised response time or bounty program.

## Boundaries

The current worker trusts Glue's quote/fulfillment API and the dedicated key approved in Tempo Wallet. Tempo Wallet handles passkey approval of the dedicated key allowance and expiry. Local policy files are not an onchain permission boundary. `maxSpend` excludes additional source network fees. See [operations](docs/operations.md).

Uncertain submissions must remain pending. Do not initiate another payment to recover from a timeout. Never reset a user's saved state, broaden wallet permissions or perform a live payment without explicit authorization.

CI uses mock payments, read-only tokens and no wallet secrets. Runtime policies, receipts, environment files and credentials must stay untracked. Only the current main branch receives fixes during this prototype stage.
