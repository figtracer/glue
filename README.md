# <img src="docs/assets/glue.png" width="28" height="28" alt=""> glue

[![CI](https://github.com/figtracer/glue/actions/workflows/ci.yml/badge.svg)](https://github.com/figtracer/glue/actions/workflows/ci.yml)

small services for getting funds where they need to be. gas refill first.

[website](https://glue.figtracer.com) · [getting started](#getting-started) · [operating guide](docs/operations.md) · [contributing](CONTRIBUTING.md) · [ideas](docs/ideas.md)

## What is glue?

Glue adds small services agents can enable around Tempo. Tempo owns the wallet, passkey approval and spending authority. Glue handles the jobs.

The first service watches a wallet's native gas balance. Below your threshold, it pays through [Glue's MPP API](https://glue.figtracer.com/llms.txt), tracks delivery and checks again later. It runs locally, even after you close the terminal.

Pay from Tempo mainnet with pathUSD or USDC.e. The CLI supports native ETH on Base, Ethereum, Arbitrum and Optimism. The website also offers one-off refills and Sepolia routes.

This is an early prototype, not an official Tempo feature. More services can follow as we learn what is useful and Tempo brings routes in-house.

## Getting started

You need Node >=22.13, a [Tempo Wallet](https://wallet.tempo.xyz/), and macOS or Linux with a working user scheduler.

```sh
git clone https://github.com/figtracer/glue.git
cd glue
npm ci --ignore-scripts
npm link --ignore-scripts

glue init --policy .glue/base.local.json \
  --sender YOUR_TEMPO_WALLET --recipient YOUR_BASE_WALLET \
  --chain base --token pathusd \
  --below-eth 0.00002 --amount 0.05 --min-receive-eth 0.000001 \
  --max-spend 0.25 --fee-reserve 0.01 --duration 30m

glue run --policy .glue/base.local.json
```

Replace the addresses. This creates the job and checks its balance or previews a quote without paying. The amounts are examples; provider minimums and gas costs vary.

Install the service when you are ready to enable refills:

```sh
glue install gas --policy .glue/base.local.json --accept-network-fees --approve
```

Tempo Wallet opens for your passkey approval. This example requests one 30-minute key with a **0.26 token allowance**: up to 0.25 for refills, plus 0.01 of network-fee headroom. The duration starts when approval is requested. Tempo owns the expiry and combined spending limit; there is no second Glue deadline.

Once approved, Glue checks every 60 seconds by default through launchd on macOS or a systemd user timer on Linux. One `gas` service is supported. The computer must be awake, online and running your user scheduler.

| Command              | What it does                                            |
| -------------------- | ------------------------------------------------------- |
| `glue status`        | Show the installed job, latest outcome and Tempo grant  |
| `glue logs gas`      | Read the latest 100 events                              |
| `glue stop gas`      | Stop local scheduling                                   |
| `glue start gas`     | Resume the same job with its existing authority         |
| `glue uninstall gas` | Remove scheduling; keep the grant, journal and receipts |

Expiry or an exhausted budget stops new payments. Starting or reinstalling does not renew authority or reset spending. The timer can remain installed while reporting that the job cannot pay. See [running and renewing a job](docs/operations.md).

For a foreground worker, use `glue run --policy FILE --execute --accept-network-fees --watch` instead of installing a service.

## Development

```sh
npm ci --ignore-scripts
npm run ci
```

CI checks formatting, lint, syntax and tests on Linux and macOS, including the minimum Node version. Tests use local mocks, never a funded wallet. See [contributing](CONTRIBUTING.md) and the [project layout](docs/README.md).
