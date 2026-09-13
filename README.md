# <img src="docs/assets/glue.png" width="28" height="28" alt=""> glue

[![CI](https://github.com/figtracer/glue/actions/workflows/ci.yml/badge.svg)](https://github.com/figtracer/glue/actions/workflows/ci.yml)

small services for keeping your agents funded.

[website](https://glue.figtracer.com) · [services](docs/services/README.md) · [agent instructions](AGENTS.md) · [getting started](#getting-started) · [operating guide](docs/operations.md) · [contributing](CONTRIBUTING.md) · [ideas](docs/ideas.md)

Glue funds prepared work, keeps agent wallets topped up, and maintains payment tokens on Tempo. Use your existing Tempo wallet and a bounded passkey approval. The website handles one-off gas refills; the CLI runs local services.

No Glue fees or markup. Network and provider costs apply. No model, database server or container runs your checks. This is an independent prototype, not an official Tempo feature.

## Services

```sh
glue services
glue services --json
```

The catalog is bundled with the CLI. Browsing it needs no login and enables nothing. `glue list` finds your saved local jobs; `glue status NAME` checks a job’s live state.

| Service                                         | What it does                                  | Use it                            |
| ----------------------------------------------- | --------------------------------------------- | --------------------------------- |
| [Gas maintenance](docs/services/gas.md)         | Watch native gas and refill below a threshold | Local service: `glue install gas` |
| [Prepared funding](docs/services/ready.md)      | Fund the native shortfall for prepared work   | `glue init ready --help`          |
| [Fleet funding](docs/services/fleet.md)         | Coordinate active wallets under one budget    | `glue init fleet --help`          |
| [Tempo token reserve](docs/services/reserve.md) | Buy a missing payment token on Tempo          | `glue init reserve --help`        |
| [On-demand refuel](docs/services/refuel.md)     | Get gas for a wallet when you need it         | Website or MPP request            |

[Browse current services →](docs/services/README.md)

## Getting started

Install the CLI with Node >=22.13:

```sh
git clone https://github.com/figtracer/glue.git
cd glue
npm ci --omit=dev --ignore-scripts
npm link --omit=dev --ignore-scripts
```

Pick a [service](docs/services/README.md), run its `init` command, preview with `glue run --policy FILE`, then install it and approve in Tempo Wallet. Installation of the CLI alone enables nothing.

For a one-off refill, open [glue.figtracer.com](https://glue.figtracer.com). Agents can use the [MPP instructions](https://glue.figtracer.com/llms.txt).

## Development

```sh
npm ci --ignore-scripts
npm run ci
```

CI checks formatting, lint, syntax and tests on Linux and macOS, including the minimum Node version. Tests use local mocks, never a funded wallet. See [contributing](CONTRIBUTING.md) and the [project layout](docs/README.md).
