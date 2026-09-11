# <img src="docs/assets/glue.png" width="28" height="28" alt=""> glue

[![CI](https://github.com/figtracer/glue/actions/workflows/ci.yml/badge.svg)](https://github.com/figtracer/glue/actions/workflows/ci.yml)

small services for getting funds where they need to be. gas refill first.

[website](https://glue.figtracer.com) · [services](docs/services/README.md) · [agent instructions](AGENTS.md) · [getting started](#getting-started) · [operating guide](docs/operations.md) · [contributing](CONTRIBUTING.md) · [ideas](docs/ideas.md)

## What is glue?

Glue adds small services agents can enable around Tempo. Tempo owns the wallet, passkey approval and spending authority. Glue handles the jobs.

The first service watches a wallet's native gas balance. Below your threshold, it pays through [Glue's MPP API](https://glue.figtracer.com/llms.txt), tracks delivery and checks again later. It runs locally, even after you close the terminal.

Pay from Tempo mainnet with pathUSD or USDC.e. The CLI supports native ETH on Base, Ethereum, Arbitrum and Optimism. The website also offers one-off refills and Sepolia routes.

This is an early prototype, not an official Tempo feature. More services can follow as we learn what is useful and Tempo brings routes in-house.

## Services

Pick what you need. Each service has its own setup and usage page.

| Service                                     | What it does                                  | Use it                            |
| ------------------------------------------- | --------------------------------------------- | --------------------------------- |
| [Gas maintenance](docs/services/gas.md)     | Watch native gas and refill below a threshold | Local service: `glue install gas` |
| [On-demand refuel](docs/services/refuel.md) | Get gas for a wallet when you need it         | Website or MPP request            |

[Browse current services →](docs/services/README.md)

## Getting started

Install the CLI with Node >=22.13:

```sh
git clone https://github.com/figtracer/glue.git
cd glue
npm ci --ignore-scripts
npm link --ignore-scripts
```

Then choose a [service](docs/services/README.md). For automatic refills, follow the [gas maintenance setup](docs/services/gas.md#enable): configure your wallet and threshold, approve a bounded Tempo grant, and install the local service. Installing the CLI alone does not enable payments or scheduling.

For a one-off refill, open [glue.figtracer.com](https://glue.figtracer.com). Agents can use the [MPP instructions](https://glue.figtracer.com/llms.txt).

## Development

```sh
npm ci --ignore-scripts
npm run ci
```

CI checks formatting, lint, syntax and tests on Linux and macOS, including the minimum Node version. Tests use local mocks, never a funded wallet. See [contributing](CONTRIBUTING.md) and the [project layout](docs/README.md).
