# <img src="docs/assets/glue.png" width="28" height="28" alt=""> glue

[![CI](https://github.com/figtracer/glue/actions/workflows/ci.yml/badge.svg)](https://github.com/figtracer/glue/actions/workflows/ci.yml)

small services for keeping your agents funded.

[website](https://glue.figtracer.com) · [services](docs/services/README.md) · [agent instructions](AGENTS.md) · [getting started](#getting-started) · [operating guide](docs/operations.md) · [contributing](CONTRIBUTING.md) · [ideas](docs/ideas.md)

Glue keeps wallets ready using your existing Tempo wallet and a bounded passkey approval. One local `refill` service covers a wallet, a fleet, prepared work, or a Tempo payment-token balance. The website handles one-off gas refills.

No Glue fees or markup. Network and provider costs apply. No model, database server or container runs your checks. This is an independent prototype, not an official Tempo feature.

## Services

```sh
glue services
glue services --json
```

The catalog is bundled with the CLI. Browsing it needs no login and enables nothing. `glue list` finds your saved local jobs; `glue status NAME` checks a job’s live state.

| Service                                     | What it does                                             | Use it                    |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------- |
| [Refill](docs/services/refill.md)           | Maintain wallets, prepared work, or Tempo payment tokens | `glue init refill --help` |
| [On-demand refuel](docs/services/refuel.md) | Get gas immediately through the website or MPP           | Website or MPP request    |

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
