import { Provider, Storage } from "accounts/cli";
import { createPublicClient, http, toFunctionSelector } from "viem";
import { tempo as chain } from "viem/chains";
import { Actions } from "viem/tempo";
import { Mppx, tempo } from "mppx/client";
import { join } from "node:path";
import { TOKENS, units } from "./worker.mjs";

export function checkChallenge(config, pending, challenge) {
  const request = challenge.request;
  if (
    challenge.method !== "tempo" ||
    challenge.intent !== "charge" ||
    request.currency?.toLowerCase() !== TOKENS[config.token] ||
    request.amount !== units(config.amount, 6).toString() ||
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
  });
  const client = createPublicClient({
    chain,
    transport: http(undefined, { retryCount: 0, timeout: 30000 }),
  });
  async function hydrate() {
    await provider.request({ method: "eth_accounts" });
  }
  return {
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
                scopes: [
                  { address: TOKENS[config.token], selector: "transfer(address,uint256)" },
                  {
                    address: TOKENS[config.token],
                    selector: "transferWithMemo(address,uint256,bytes32)",
                  },
                ],
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
      const selectors = new Set([
        toFunctionSelector("transfer(address,uint256)"),
        toFunctionSelector("transferWithMemo(address,uint256,bytes32)"),
      ]);
      if (
        record.scopes?.length !== 2 ||
        record.scopes.some((scope) => {
          const selector = scope.selector?.startsWith("0x")
            ? scope.selector
            : scope.selector
              ? toFunctionSelector(scope.selector)
              : "";
          return (
            scope.address.toLowerCase() !== TOKENS[config.token] || !selectors.delete(selector)
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
      const prepared = await payment.prepare(response);
      checkChallenge(config, pending, prepared.challenge);
      const credential = await prepared.createCredential();
      await write;
      return credential;
    },
  };
}
