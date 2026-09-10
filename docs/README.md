# Developer docs

A small map of the repo:

| Path                | Owns                                               |
| ------------------- | -------------------------------------------------- |
| `src/cli.mjs`       | Commands, policy loading and the polling loop      |
| `src/service.mjs`   | Installed job lifecycle, status and bounded logs   |
| `src/scheduler.mjs` | User-level launchd and systemd registration        |
| `src/worker.mjs`    | Thresholds, budgets and order state transitions    |
| `src/wallet.mjs`    | Tempo grants, keychain reads and MPP signing       |
| `src/io.mjs`        | Durable state, locking, RPC and Tempo/Glue calls   |
| `test/`             | Unit and executable-level tests with mock payments |

Start with the [operating guide](operations.md) for state and recovery. [Ideas](ideas.md) are proposals, not implemented features.

Keep new services beside the existing code until a shared abstraction earns its place. Tempo Accounts handles authorization/key storage and MPP handles payments. All dependencies are lockfile-pinned.
