# Docs

Start with [current services](services/README.md) to pick what to enable. Each service page covers its setup and usage. The [operating guide](operations.md) covers budgets, expiry and recovery. [Ideas](ideas.md) are future candidates.

## Project layout

A small map of the repo:

| Path                    | Owns                                               |
| ----------------------- | -------------------------------------------------- |
| `src/cli.mjs`           | Commands, policy loading and the polling loop      |
| `src/service.mjs`       | Installed job lifecycle, status and bounded logs   |
| `src/scheduler.mjs`     | User-level launchd and systemd registration        |
| `src/worker.mjs`        | Thresholds, budgets and order state transitions    |
| `src/authorization.mjs` | Grant approval, binding and recovery               |
| `src/wallet.mjs`        | Tempo grants, keychain reads and MPP signing       |
| `src/io.mjs`            | Durable state, locking, RPC and Tempo/Glue calls   |
| `test/`                 | Unit and executable-level tests with mock payments |

Keep new services beside the existing code until a shared abstraction earns its place. Tempo Accounts handles authorization/key storage and MPP handles payments. All dependencies are lockfile-pinned.
