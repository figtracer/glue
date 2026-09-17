# On-demand refuel

pay less to get started.

Get gas for a wallet with one request. Pay from Tempo mainnet with pathUSD or USDC.e and receive native ETH on Base, Ethereum, Arbitrum, Optimism or Robinhood, or native TRX on Tron.

## Use it

**In a browser:** open [glue.figtracer.com](https://glue.figtracer.com), choose a destination battery from the case, enter the amount and recipient, review the quote and pay. The website also offers Sepolia ETH on Base, Ethereum, Arbitrum and Optimism; Tron and Robinhood are mainnet-only.

**With an agent:** give it [Glue's llms.txt](https://glue.figtracer.com/llms.txt). That is the source for supported MPP requests, payment handling and delivery tracking.

For Tron, use chain ID `728126428` and a case-sensitive Base58Check receiving address beginning with `T`. You must control the receiving wallet, but do not need to connect it to Glue. TRX has six decimals; do not interpret the compatibility fields `expectedEth` and `minimumEth` as ETH. The MPP response's `outputSymbol` and `outputDecimals` identify the output units. Follow its `statusUrl` to confirm destination delivery; a Tempo payment receipt alone does not prove TRX arrived.

This service runs through the website and API. No local scheduler is installed. To keep an EVM wallet funded automatically, enable [refill](refill.md). Scheduled local refills do not currently support Tron or Robinhood.

[← Current services](README.md)
