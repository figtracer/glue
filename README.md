# <img src="docs/assets/glue.png" width="28" height="28" alt=""> glue

[![CI](https://github.com/figtracer/glue/actions/workflows/ci.yml/badge.svg)](https://github.com/figtracer/glue/actions/workflows/ci.yml)

small services for getting funds where they need to be. gas refill first.

[website](https://glue.figtracer.com) · [getting started](#getting-started) · [operating guide](docs/operations.md) · [contributing](CONTRIBUTING.md) · [ideas](docs/ideas.md)

## What is glue?

Glue is a playground for agent services around funding and keeping wallets usable. Today it watches a wallet's gas balance and refills it through [Glue's MPP API](https://glue.figtracer.com/llms.txt), using your existing Tempo Wallet.

Base, Ethereum, Arbitrum and Optimism are supported. Pay with pathUSD or USDC.e. More services can follow as we learn what is useful and Tempo brings routes in-house.

This is an early prototype, not an official Tempo feature. Budgets and expiry are enforced locally. Tempo passkeys approve an allowance on your existing key; Glue does not provision a dedicated key.

## Getting started

Node >=22.13 and a configured [Tempo Wallet](https://tempo.xyz/) are required. No runtime dependencies.

```sh
git clone https://github.com/figtracer/glue.git
cd glue
npm ci --ignore-scripts
npm link --ignore-scripts

glue init --policy .glue/base.local.json \
  --sender YOUR_TEMPO_WALLET --recipient YOUR_BASE_WALLET \
  --chain base --token pathusd \
  --below-eth 0.00002 --amount 0.05 --min-receive-eth 0.000001 \
  --max-spend 0.25 --expires-at YOUR_FUTURE_UTC_TIMESTAMP

glue run --policy .glue/base.local.json
```

Replace the addresses and timestamp. Use a future UTC timestamp ending in `Z`. The amounts are examples; provider minimums and gas costs vary. This previews a quote. Nothing is paid or scheduled on install.

Preview the key allowance, then approve it in Tempo Wallet with your passkey:

```sh
glue authorize --policy .glue/base.local.json
glue authorize --policy .glue/base.local.json --approve
glue run --policy .glue/base.local.json --execute --accept-network-fees --watch
```

`maxSpend` caps MPP token charges. Tempo network fees are additional. Keep the policy and state: deleting them can reset the budget. Read the [operating guide](docs/operations.md) before leaving a worker running.

## Development

```sh
npm ci --ignore-scripts
npm run ci
```

CI checks formatting, lint, syntax and tests on Linux and macOS, including the minimum Node version. Tests use local mocks, never a funded wallet. See [contributing](CONTRIBUTING.md), [project layout](docs/README.md).
