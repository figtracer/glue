# glue

Keep this prototype small. Gas refill is the first service; do not introduce a generic framework or copy Bloom wholesale. No runtime dependencies without a concrete need.

Run npm ci --ignore-scripts and npm run ci. Payment changes need coverage for crash/retry, expiry, budget and no duplicate submission. Use mock payments unless the user explicitly authorizes a bounded live test.

Never commit .glue, policy/state files with user wallets, credentials or payment artifacts. Never reset pending payment state to make a test pass. The CLI charge budget excludes source network fees; do not claim an all-in cap or VK/onchain enforcement that does not exist.
