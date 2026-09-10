# Contributing

keep it small. show the problem, then the change.

Open an issue before adding a new service or changing payment authority. For bugs, include the command, Node/Tempo versions, OS, expected result and a small reproduction. Redact wallet data and credentials.

## Working on a change

```sh
npm ci --ignore-scripts
npm run ci
```

`npm run fmt` formats the repo. `npm run lint` checks JavaScript. `npm test` runs unit tests and the executable against local RPC/payment mocks. No live wallet or secrets are needed in CI.

Keep payment behavior changes covered: wrong quotes, expiry, budget exhaustion, duplicate triggers and restart after submission. Never delete pending state to make a test pass. A live payment test requires an explicit destination and spending budget; record its limits and outcome separately.

## Pull requests

Use a short conventional title, such as `fix: preserve pending refill on timeout`. Explain the problem and resulting behavior, with evidence that exercises the changed path. Keep unrelated cleanup separate. Disclose AI assistance and what it contributed. Maintainer branches use `fig/`.

Run all checks before requesting review. Payment logic and CI changes deserve particular attention. See [security](SECURITY.md) for sensitive reports and the [operating guide](docs/operations.md) for the authority boundaries we must preserve.

Dependencies must have a concrete purpose. Commit the lockfile, keep GitHub Actions pinned to full commit SHAs, and preserve read-only CI permissions. New Action revisions should be at least seven days old unless a specific security fix justifies an exception.
