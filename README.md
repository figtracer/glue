# <img src="docs/assets/glue.png" width="28" height="28" alt=""> glue

[![CI](https://github.com/figtracer/glue/actions/workflows/ci.yml/badge.svg)](https://github.com/figtracer/glue/actions/workflows/ci.yml)

small services for getting funds where they need to be. gas refill first.

[website](https://glue.figtracer.com) · [services](docs/services/README.md) · [agent instructions](AGENTS.md) · [getting started](#getting-started) · [operating guide](docs/operations.md) · [contributing](CONTRIBUTING.md) · [ideas](docs/ideas.md)

Glue watches gas and refills when needed, using your Tempo wallet and a bounded passkey approval. The website handles one-off refills; the CLI keeps a wallet funded locally.

No Glue fees or markup. Network and provider costs apply. No model, database server or container runs your checks. This is an independent prototype, not an official Tempo feature.

## Services

```sh
glue services
glue services --json
```

The catalog is bundled with the CLI. Browsing it needs no login and enables nothing.

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
npm ci --omit=dev --ignore-scripts
npm link --omit=dev --ignore-scripts
```

Follow the [gas setup](docs/services/gas.md#enable). Installation alone enables nothing.

For a one-off refill, open [glue.figtracer.com](https://glue.figtracer.com). Agents can use the [MPP instructions](https://glue.figtracer.com/llms.txt).

## Development

```sh
npm ci --ignore-scripts
npm run ci
```

CI checks formatting, lint, syntax and tests on Linux and macOS, including the minimum Node version. Tests use local mocks, never a funded wallet. See [contributing](CONTRIBUTING.md) and the [project layout](docs/README.md).
