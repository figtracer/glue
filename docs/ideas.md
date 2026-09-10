# Where glue can go

pay less to get started — and keep things running.

Glue is a small playground for agent services around Tempo: funding, onramping and keeping wallets usable. Gas refill is the first service. The direction is a set of useful jobs agents can explicitly enable, with delivery moving to in-house routes as those become available.

## What exists

`glue install gas` installs a local service that watches native gas and requests a fixed-size refill below a threshold. It uses the existing Glue MPP API and supports Base, Ethereum, Arbitrum and Optimism. launchd or a systemd user timer wakes the worker; Glue checks whether action is needed, pays once and reconciles delivery.

Tempo Wallet passkeys approve a dedicated key through the official Accounts SDK. Tempo owns the expiry and combined token allowance. Glue owns the destination, threshold, charge budget, routing and receipt logic. Pending payments and spending history survive restarts and uninstall.

VK is optional future work for other kinds of human-approved actions. Gas refill already uses Tempo passkeys and does not need a separate VK approval or local expiry policy.

See the [operating guide](operations.md) for the implemented workflow. The ideas below are candidates, not available commands.

## Useful services next

| Service                | Behavior                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| Transaction readiness  | Estimate a prepared transaction and fund its gas shortfall               |
| Deployment readiness   | Check deployer wallets and confirm funding before a release              |
| Agent allowance        | Fund an agent wallet from a Tempo treasury within an approved cap        |
| Payment reconciliation | Gather outstanding payments, deliveries and refunds into a digest        |
| Approval expiry        | Notify when authority needs attention, without renewing it automatically |
| Scheduled MPP request  | Run a specific service request with fixed input and cost bounds          |

Deployment readiness is a natural Foundry-oriented experiment. More services should earn their place through real usage; we do not need a generic plugin runtime yet.

Installing the CLI alone starts nothing. Enabling a paid service requires its configuration and Tempo authority. An agent can propose the job; deterministic code decides whether a payment is allowed.

## What to borrow from Bloom

Borrow the read → plan → authorize → execute → receipt model and explicit capability boundaries. Evaluate narrow pieces rather than importing the entire runtime. No Bloom code is copied into this prototype.

Local scheduling is now implemented in Glue. Future templates should reuse the same authority and recovery boundaries where they fit, without forcing every service into the gas-refill shape.

## In-house ramps

MPP collects payment; someone still needs destination ETH to deliver it. Paying from Tempo does not itself supply liquidity on Base.

Use the existing routing providers while the service layer develops. Glue's mainnet API uses Relay; its website's Sepolia routes also use Gas.zip. When in-house routes become available, adapt fulfillment while preserving the user's grant and job history. Changes in custody or authority need explicit treatment.

Start without destination inventory. Direct delivery becomes worth considering when volume, replenishment cost and working capital justify it.

## Business ideas

Personal wallet maintenance can stay local. Hosted availability and recovery could be useful for machines that sleep or disconnect. Deployment readiness could serve Foundry teams; embedded wallet maintenance could serve agent platforms.

Tiny refill fees alone may not support much of a business. Reliability, shared workflows and accounting are hypotheses worth testing. No pricing or demand is established yet.

Hosted execution would need explicit authority, isolation and one active executor per job. Local scheduling gives us the first working workflow to build from.

## References

- [Glue](https://glue.figtracer.com/) and [MPP API](https://glue.figtracer.com/llms.txt)
- [Bloom](https://github.com/bloom-directory/bloom)
- [Tempo human authorization / VK](https://x.com/tempo/article/2090136779470844299)
- [TIP-1011: enhanced access-key permissions](https://github.com/tempoxyz/tempo/blob/main/tips/tip-1011.md)
- [Relay solver model](https://docs.relay.link/references/protocol/guides/for-solvers)

The initial Omp consultation helped select gas maintenance and deployment readiness as experiments. These notes now distinguish that brainstorming from the shipped local service.
