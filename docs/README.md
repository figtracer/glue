# Developer docs

A small map of the repo:

| Path             | Owns                                               |
| ---------------- | -------------------------------------------------- |
| `src/cli.mjs`    | Commands, policy loading and the polling loop      |
| `src/worker.mjs` | Thresholds, budgets and order state transitions    |
| `src/io.mjs`     | Durable state, locking, RPC and Tempo/Glue calls   |
| `test/`          | Unit and executable-level tests with mock payments |

Start with the [operating guide](operations.md) for state and recovery. The [validation record](validation.md) describes the first live test. [Ideas](ideas.md) are proposals, not implemented features.

Keep new services beside the existing code until a shared abstraction earns its place. The runtime currently has no package dependencies; developer tooling is lockfile-pinned.
