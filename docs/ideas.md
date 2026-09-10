# glue

pay less to get started — and keep things running.

Glue is a small pre-Tempo playground for agent services around funding, onramping and keeping wallets usable. Gas refill is the first service, not the entire identity of the project. The eventual direction is a set of useful services agents can explicitly enable through Tempo, with delivery moving to in-house routes as those become available.

## First experiment: keep a wallet funded

A person or agent creates a bounded rule: watch this wallet on this chain, refill below a threshold, spend only this much, and stop at this time. The worker reads the balance, obtains a quote, pays through Glue's MPP endpoint, and checks delivery before considering another refill.

Cron or a timer only wakes the worker up. The valuable part is deciding whether action is needed, respecting the allowance, handling ambiguous outcomes, and producing a receipt.

The first implementation is deliberately small: one policy per job, fixed-size refills, a native ETH threshold, an explicit total token-charge budget and expiry. It uses the existing Tempo Wallet CLI and Glue API. No new key custody, generic plugin runtime, hosted scheduler or liquidity inventory.

## Human approval: Voight-Kampff + payment authority

Tempo's Voight-Kampff (VK) demonstrates physical human approval of an exact action through Touch ID and a Secure Enclave signing key. Its article describes PR, deployment and infrastructure approvals. It does not document a public integration or built-in recurring spending mandates.

Our proposed adaptation is to approve the creation of an exact, versioned rule: source wallet/token, destination chain/address, trigger, amount/output bounds, permitted providers, budgets and expiry. The approval request has a short validity window; the resulting rule would have its own deliberately chosen duration.

Three things remain separate:

- VK proves human intent to enable the exact rule.
- A scoped Tempo access key permits payment operations.
- Glue's worker checks the rule, executes and reconciles delivery.

TIP-1011 provides periodic token limits and call/recipient scoping, but cannot enforce arbitrary cross-chain refill logic. A rule hash in a log is insufficient: the actual quote and payment must be checked against the approved rule at the signing boundary. Glue's payee may change per order, so a static recipient allowlist alone is not a complete integration.

Expiry or revocation stops new payment attempts. Already-paid orders still need reconciliation. Broader budgets, different destinations or longer durations require fresh approval. Local policy files in the prototype are not biometric or cryptographic authorization.

## Useful service candidates

| Service                | Behavior                                                                                    | Timing                         |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| Gas refill             | Maintain a named wallet's native gas reserve                                                | First prototype                |
| Transaction readiness  | Estimate a prepared transaction and fund its gas shortfall                                  | Next candidate                 |
| Deployment readiness   | Check a team's deployer wallets, approve a refill batch and confirm delivery before release | Strong Foundry-oriented option |
| Agent allowance        | Replenish a named agent wallet from the user's Tempo treasury within a cap                  | Same-chain candidate           |
| Payment reconciliation | Resolve outstanding payments/deliveries/refunds and produce a digest                        | Shared operational feature     |
| Approval expiry        | Warn before authority expires and pause affected jobs                                       | Shared operational feature     |
| Scheduled MPP request  | Run an approved service request on a schedule with fixed input/cost bounds                  | Later generalization           |

Templates should be inspectable and disabled until configured. Installing the CLI must not start daemons or authorize spending. An agent can propose rules and explain exceptions; deterministic code should decide whether a payment is allowed.

## What to adopt from Bloom

Bloom is an agent wallet exposed as a virtual filesystem, with chain reads, transaction plans, signing boundaries, paid HTTP requests and modular Wasm Petals. It already has a Tempo MPP adapter.

Borrow its read → plan → authorize → execute → receipt model and explicit capability declarations. Evaluate narrow components rather than importing the full runtime. The inspected balance watcher at commit 8fd2ddffb655f5a0cd5d9b6f2edc16a35bbadd78 ignores threshold/comparator fields and selects the first configured chain; it is not a finished multi-chain refill scheduler. No Bloom code is copied into this prototype.

## In-house ramps and liquidity

MPP collects payment; it does not supply destination ETH. Immediate delivery requires someone to hold that ETH: us, a liquidity supplier, or a routing provider's solver. Customer payment on Tempo does not make ETH instantly available on Base.

Keep fulfillment behind a small adapter boundary. Use Relay now for mainnet; existing Glue uses Relay plus Gas.zip for Sepolia. Later use in-house routes where available, while keeping the user's rule and job history intact. Material changes in custody or authority must not be hidden behind a backend switch.

Owning the user experience does not require owning every bridge or exchange. Start without destination inventory. Only consider direct delivery once volume, replenishment cost and working-capital requirements justify it.

## Product options and economics

1. Personal wallet maintenance: free local operation, optional hosted reliability and explicit delivery fees.
2. Deployment readiness for Foundry teams: shared approvals, CI integration and receipt history; potential team subscription.
3. Embedded wallet maintenance for agent platforms: per-tenant budgets, reconciliation and webhooks; potential platform minimum plus usage.

A percentage-only fee on tiny refills is thin. Hosted availability, recovery, shared policies and accounting may be worth more. These are hypotheses to test, not established demand or pricing.

Local execution is the first step. Sleeping laptops miss checks; on wake, evaluate current state instead of replaying missed spending runs. Hosted execution needs explicit authority, isolation and one active executor per job. It is not just moving cron to a server.

## First workflow evidence

Test: below threshold → quote → one MPP payment → pending delivery → delivered → no duplicate refill. Also cover budget exhaustion, expiry, pause, changed policies, stale quotes, concurrency, refunds and restart after ambiguous submission.

The prototype caps cumulative MPP token charges. Tempo network fees are additional and must be explicitly accepted. It does not provision a narrowly scoped key, integrate VK, or enforce budgets against a malicious local process. Unknown payment outcomes stay pending rather than initiating another charge. Refunds do not automatically replenish the local budget.

## Sources and consultation

- [Glue](https://glue.figtracer.com/) and [agent API](https://glue.figtracer.com/llms.txt)
- [Bloom](https://github.com/bloom-directory/bloom)
- [Bloom Petals](https://github.com/bloom-directory/bloom/blob/master/docs/petals/README.md)
- [Tempo human authorization / VK](https://x.com/tempo/article/2090136779470844299)
- [TIP-1011: enhanced access-key permissions](https://github.com/tempoxyz/tempo/blob/main/tips/tip-1011.md)
- [Relay solver model](https://docs.relay.link/references/protocol/guides/for-solvers)

An Omp Oracle consultation with Astra independently recommended gas maintenance as the first experiment, deployment readiness as the strongest alternative, and borrowing Bloom's boundaries rather than its full engine. The driver verified the material observations against source. Design notes, September 2026; future features above are proposals.
