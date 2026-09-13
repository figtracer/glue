import { Provider, Storage } from "accounts/cli";
import { createPublicClient, http, toFunctionSelector, decodeEventLog } from "viem";
import { tempo as chain } from "viem/chains";
import { Actions, Addresses, Abis } from "viem/tempo";
import { Mppx, tempo } from "mppx/client";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { TOKENS, units } from "./worker.mjs";

export function checkChallenge(config, pending, challenge) {
  const request = challenge.request;
  if (
    challenge.method !== "tempo" ||
    challenge.intent !== "charge" ||
    request.currency?.toLowerCase() !== TOKENS[config.token] ||
    request.amount !== units(pending.body.amount, 6).toString() ||
    request.recipient?.toLowerCase() !== pending.offer.paymentRecipient.toLowerCase() ||
    request.methodDetails?.chainId !== 4217 ||
    request.methodDetails?.splits?.length
  )
    throw new Error("MPP payment challenge differs from the approved quote.");
}

export function createWallet(config, directory) {
  const storage = Storage.filesystem({ path: join(directory, "tempo-wallet.json"), key: "glue" });
  let write = Promise.resolve();
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (...args) => {
    write = setItem(...args);
    return write;
  };
  const provider = Provider.create({
    chains: [chain],
    name: "glue",
    rdns: "com.figtracer.glue",
    storage,
    mpp: false,
    timeout: 16 * 60 * 1000,
    open(url, prompt) {
      process.stdout.write(`Approve in Tempo Wallet: ${url}\nCode: ${prompt.userCode}\n`);
      const [command, ...args] =
        process.platform === "darwin"
          ? ["open", url]
          : process.platform === "win32"
            ? ["cmd", "/c", "start", "", url]
            : ["xdg-open", url];
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.on("error", () => process.stderr.write("Open the approval link above manually.\n"));
      child.unref();
    },
  });
  const client = createPublicClient({
    chain,
    transport: http(undefined, { retryCount: 0, timeout: 30000 }),
  });
  async function hydrate() {
    await provider.request({ method: "eth_accounts" });
  }
  const scopes =
    config.service === "reserve"
      ? [
          {
            address: TOKENS[config.token],
            selector: "approve(address,uint256)",
            recipients: [Addresses.stablecoinDex],
          },
          {
            address: Addresses.stablecoinDex,
            selector: "swapExactAmountOut(address,address,uint128,uint128)",
          },
        ]
      : [
          { address: TOKENS[config.token], selector: "transfer(address,uint256)" },
          { address: TOKENS[config.token], selector: "transferWithMemo(address,uint256,bytes32)" },
        ];
  return {
    async tokenBalance(token) {
      return client.readContract({
        address: TOKENS[token],
        abi: Abis.tip20,
        functionName: "balanceOf",
        args: [config.sender],
      });
    },
    async quoteSwap(amountOut) {
      return client.readContract({
        address: Addresses.stablecoinDex,
        abi: Abis.stablecoinDex,
        functionName: "quoteSwapExactAmountOut",
        args: [TOKENS[config.token], TOKENS[config.receiveToken], amountOut],
      });
    },
    async signSwap(amountOut, maxAmountIn, signal) {
      signal?.throwIfAborted();
      await hydrate();
      const { loadState } = await import("./io.mjs");
      const { checkGrant } = await import("./authorization.mjs");
      const state = await loadState(directory);
      const grant = await this.authority(state.authorization.key);
      checkGrant(config, state.authorization, grant, Date.now());
      const account = await provider.store.accessKeys.get({
        account: config.sender,
        chainId: 4217,
        accessKey: state.authorization.key,
      });
      if (!account) throw new Error("Authorized Tempo signing key unavailable.");
      const { prepareTransactionRequest } = await import("viem/actions");
      const calls = [
        Actions.token.approve.call({
          token: TOKENS[config.token],
          spender: Addresses.stablecoinDex,
          amount: maxAmountIn,
        }),
        Actions.dex.buy.call({
          tokenIn: TOKENS[config.token],
          tokenOut: TOKENS[config.receiveToken],
          amountOut,
          maxAmountIn,
        }),
        Actions.token.approve.call({
          token: TOKENS[config.token],
          spender: Addresses.stablecoinDex,
          amount: 0n,
        }),
      ];
      signal?.throwIfAborted();
      const validBefore = Math.min(grant.expiry, Math.floor(Date.now() / 1000) + 60);
      const request = await prepareTransactionRequest(client, {
        account,
        calls,
        type: "tempo",
        feeToken: TOKENS[config.token],
        validBefore,
        nonceKey: "expiring",
      });
      signal?.throwIfAborted();
      const signed = await account.signTransaction(request);
      return { signed, validBefore };
    },
    broadcastSwap: (serializedTransaction) => client.sendRawTransaction({ serializedTransaction }),
    async swapReceipt(hash) {
      try {
        return await client.getTransactionReceipt({ hash });
      } catch (error) {
        if (error.name === "TransactionReceiptNotFoundError") return null;
        throw error;
      }
    },
    swapOutcome(receipt, token) {
      let received = 0n;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== TOKENS[token]) continue;
        try {
          const decoded = decodeEventLog({ abi: Abis.tip20, ...log });
          if (
            decoded.eventName === "Transfer" &&
            decoded.args.to.toLowerCase() === config.sender.toLowerCase()
          )
            received += decoded.args.amount;
        } catch {
          /* Other token events do not prove delivery. */
        }
      }
      return received;
    },
    async connect(approval) {
      await provider.request({
        method: "wallet_connect",
        params: [
          {
            capabilities: {
              method: "login",
              authorizeAccessKey: {
                chainId: "0x1079",
                expiry: approval.requestExpiry,
                keyType: "p256",
                limits: [
                  {
                    token: TOKENS[config.token],
                    limit: `0x${BigInt(approval.limit).toString(16)}`,
                  },
                ],
                scopes,
              },
            },
          },
        ],
      });
      await write;
    },
    async authority(key) {
      await hydrate();
      const records = provider.store.accessKeys.list({
        account: config.sender,
        chainId: 4217,
        ...(key ? { accessKey: key } : {}),
      });
      if (records.length !== 1)
        throw new Error(
          "No unique Tempo grant found. An interrupted approval is not retried; keep the job state.",
        );
      const record = records[0];
      const expected = new Map(
        scopes.map((scope) => [
          `${scope.address.toLowerCase()}:${toFunctionSelector(scope.selector)}`,
          scope,
        ]),
      );
      if (
        record.scopes?.length !== expected.size ||
        record.scopes.some((scope) => {
          const selector = scope.selector?.startsWith("0x")
            ? scope.selector
            : scope.selector
              ? toFunctionSelector(scope.selector)
              : "";
          const id = `${scope.address.toLowerCase()}:${selector}`;
          const wanted = expected.get(id);
          if (!wanted) return true;
          expected.delete(id);
          return (
            JSON.stringify((scope.recipients ?? []).map((x) => x.toLowerCase()).sort()) !==
            JSON.stringify((wanted.recipients ?? []).map((x) => x.toLowerCase()).sort())
          );
        })
      )
        throw new Error("Tempo grant has unexpected call permissions.");
      let metadata;
      try {
        metadata = await Actions.accessKey.getMetadata(client, {
          account: config.sender,
          accessKey: record.address,
        });
      } catch (error) {
        let cause = error,
          missing = false;
        while (cause) {
          if (cause.data?.errorName === "KeyNotFound") missing = true;
          cause = cause.cause;
        }
        if (!missing) throw error;
      }
      const published = metadata && metadata.address.toLowerCase() === record.address.toLowerCase();
      if (metadata?.isRevoked) throw new Error("Tempo key was revoked.");
      const signed = record.keyAuthorization;
      if (!published && !signed?.signature) throw new Error("Tempo grant is missing.");
      const limit = record.limits?.find(
        (item) => item.token.toLowerCase() === TOKENS[config.token],
      );
      if (!limit || record.limits.length !== 1)
        throw new Error("Tempo grant must only authorize the selected token.");
      let remaining = limit.limit,
        period = limit.period;
      if (published) {
        const live = await Actions.accessKey.getRemainingLimit(client, {
          account: config.sender,
          accessKey: record.address,
          token: TOKENS[config.token],
        });
        remaining = live.remaining;
        period = live.periodEnd ? 1 : 0;
      }
      return {
        key: record.address,
        wallet: record.access,
        chainId: record.chainId,
        expiry: Number(published ? metadata.expiry : signed.expiry),
        limited: published ? metadata.spendPolicy === "limited" : Boolean(signed.limits),
        revoked: false,
        limit: remaining.toString(),
        period,
        source: published ? "tempo-chain" : "tempo-signed-grant",
      };
    },
    async credential(pending, response, key) {
      await hydrate();
      const payment = Mppx.create({
        polyfill: false,
        methods: [
          tempo.charge({
            ...provider.getMppxParameters({ accessKey: key }),
            expectedChainId: 4217,
            mode: "pull",
            autoSwap: false,
          }),
        ],
      });
      const prepared = await payment.preparePayment(response);
      checkChallenge(config, pending, prepared.challenge);
      const credential = await prepared.createCredential();
      await write;
      return credential;
    },
  };
}
