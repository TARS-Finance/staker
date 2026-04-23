import {
  bcs,
  RawKey,
  RESTClient,
  type RESTClientConfig,
  type Tx,
  Wallet,
} from "@initia/initia.js";
import { delegateLp as buildDelegateLpMsg } from "../staking/delegate-lp.js";
import { provideSingleAssetLiquidity as buildProvideLiquidityMsg } from "../dex/provide-single-asset-liquidity.js";
import { singleAssetProvideDelegate as buildProvideDelegateMsg } from "../vip/single-asset-provide-delegate.js";
import type {
  DelegateLpRequest,
  DelegateLpResult,
  KeeperChainClient,
  ProvideSingleAssetLiquidityRequest,
  ProvideSingleAssetLiquidityResult,
  SingleAssetProvideDelegateRequest,
  SingleAssetProvideDelegateResult,
} from "../query/types.js";

type CoinLike = {
  amount: string;
};

type CoinsLike = {
  get(denom: string): CoinLike | undefined;
};

type WalletLike = {
  createAndSignTx(input: { msgs: unknown[] }): Promise<Tx | unknown>;
  sequence(): Promise<number>;
};

type InjectedWalletLike = WalletLike & {
  accAddress?: string;
};

type RestClientLike = {
  bank: {
    balanceByDenom(address: string, denom: string): Promise<CoinLike | undefined>;
  };
  move: {
    metadata(denom: string): Promise<string>;
  };
  mstaking: {
    delegation(
      delegator: string,
      validator: string
    ): Promise<{ balance: CoinsLike }>;
  };
  tx: {
    simulate(input: {
      msgs: unknown[];
      sequence: number;
    }): Promise<{
      result: {
        events: Array<{
          type: string;
          attributes: Array<{ key: string; value: string }>;
        }>;
      };
    }>;
    broadcast(tx: Tx | unknown): Promise<{
      txhash: string;
      raw_log: string;
      code?: number | string;
    }>;
    txInfo(txHash: string): Promise<unknown>;
  };
};

export type CreateLiveKeeperChainClientInput = {
  lcdUrl: string;
  privateKey: string;
  keeperAddress: string;
  gasPrices?: string;
  gasAdjustment?: string;
  restClient?: RestClientLike;
  wallet?: InjectedWalletLike;
};

function isNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    status?: number;
    response?: {
      status?: number;
    };
  };

  return candidate.status === 404 || candidate.response?.status === 404;
}

function isBroadcastError(result: {
  code?: number | string;
}) {
  if (result.code === undefined) {
    return false;
  }

  return String(result.code) !== "0";
}

function applySlippageBps(amount: bigint, slippageBps: string) {
  const bps = BigInt(slippageBps);

  if (bps < 0n || bps > 10_000n) {
    throw new Error(`Invalid slippage bps: ${slippageBps}`);
  }

  return (amount * (10_000n - bps)) / 10_000n;
}

function extractLpQuoteFromSimulation(input: {
  events: Array<{
    type: string;
    attributes: Array<{ key: string; value: string }>;
  }>;
  targetPoolId: string;
}) {
  let lpAmount = 0n;

  for (const event of input.events) {
    const attributes = new Map(
      event.attributes.map((attribute) => [attribute.key, attribute.value])
    );
    const eventType = attributes.get("type_tag");
    const liquidityToken = attributes.get("liquidity_token");
    const liquidity = attributes.get("liquidity");

    if (
      eventType !== "0x1::dex::ProvideEvent"
      || liquidityToken !== input.targetPoolId
      || !liquidity
    ) {
      continue;
    }

    lpAmount += BigInt(liquidity);
  }

  return lpAmount;
}

async function queryBalanceByDenom(
  rest: RestClientLike,
  address: string,
  denom: string
) {
  try {
    const coin = await rest.bank.balanceByDenom(address, denom);
    return coin?.amount ?? "0";
  } catch (error) {
    if (isNotFoundError(error)) {
      return "0";
    }

    throw error;
  }
}

async function simulateQuotedLpAmount(input: {
  rest: RestClientLike;
  wallet: WalletLike;
  msg: unknown;
  targetPoolId: string;
  lpDenom: string;
}) {
  const simulation = await input.rest.tx.simulate({
    msgs: [input.msg],
    sequence: await input.wallet.sequence(),
  });
  const quotedLpAmount = extractLpQuoteFromSimulation({
    events: simulation.result.events,
    targetPoolId: input.targetPoolId,
  });

  if (quotedLpAmount <= 0n) {
    throw new Error(
      `Unable to derive a trustworthy LP quote for ${input.lpDenom} from simulation output.`
    );
  }

  return quotedLpAmount;
}

export class LiveKeeperChainClient implements KeeperChainClient {
  readonly mode = "live" as const;

  constructor(
    private readonly rest: RestClientLike,
    private readonly wallet: WalletLike,
    private readonly keeperAddress: string,
    signerAddress: string
  ) {
    if (signerAddress !== keeperAddress) {
      throw new Error(
        `Configured keeper address ${keeperAddress} does not match derived wallet address ${signerAddress}`
      );
    }
  }

  async getInputBalance(request: {
    userAddress: string;
    denom: string;
  }): Promise<string> {
    return queryBalanceByDenom(this.rest, request.userAddress, request.denom);
  }

  async getLpBalance(request: {
    userAddress: string;
    lpDenom: string;
  }): Promise<string> {
    return queryBalanceByDenom(this.rest, request.userAddress, request.lpDenom);
  }

  async getDelegatedLpBalance(request: {
    userAddress: string;
    validatorAddress: string;
    lpDenom: string;
  }): Promise<string> {
    try {
      const delegation = await this.rest.mstaking.delegation(
        request.userAddress,
        request.validatorAddress
      );

      return delegation.balance.get(request.lpDenom)?.amount ?? "0";
    } catch (error) {
      if (isNotFoundError(error)) {
        return "0";
      }

      throw error;
    }
  }

  async provideSingleAssetLiquidity(
    request: ProvideSingleAssetLiquidityRequest
  ): Promise<ProvideSingleAssetLiquidityResult> {
    const beforeLpBalance = BigInt(
      await this.getLpBalance({
        userAddress: request.userAddress,
        lpDenom: request.lpDenom,
      })
    );
    const inputCoinMetadata = await this.rest.move.metadata(request.inputDenom);
    const simulationMsg = buildProvideLiquidityMsg({
      grantee: this.keeperAddress,
      userAddress: request.userAddress,
      moduleAddress: request.moduleAddress,
      moduleName: request.moduleName,
      args: [
        bcs.object().serialize(request.targetPoolId).toBase64(),
        bcs.object().serialize(inputCoinMetadata).toBase64(),
        bcs.u64().serialize(BigInt(request.amount)).toBase64(),
        bcs.option(bcs.u64()).serialize(null).toBase64(),
      ],
    });
    const quotedLpAmount = await simulateQuotedLpAmount({
      rest: this.rest,
      wallet: this.wallet,
      msg: simulationMsg,
      targetPoolId: request.targetPoolId,
      lpDenom: request.lpDenom,
    });

    const minLiquidity = applySlippageBps(
      quotedLpAmount,
      request.maxSlippageBps
    );
    const msg = buildProvideLiquidityMsg({
      grantee: this.keeperAddress,
      userAddress: request.userAddress,
      moduleAddress: request.moduleAddress,
      moduleName: request.moduleName,
      args: [
        bcs.object().serialize(request.targetPoolId).toBase64(),
        bcs.object().serialize(inputCoinMetadata).toBase64(),
        bcs.u64().serialize(BigInt(request.amount)).toBase64(),
        bcs.option(bcs.u64()).serialize(minLiquidity).toBase64(),
      ],
    });
    const signedTx = await this.wallet.createAndSignTx({
      msgs: [msg],
    });
    const broadcast = await this.rest.tx.broadcast(signedTx);

    if (isBroadcastError(broadcast)) {
      throw new Error(
        `Provide liquidity tx failed (${broadcast.code}): ${broadcast.raw_log}`
      );
    }

    const afterLpBalance = BigInt(
      await this.getLpBalance({
        userAddress: request.userAddress,
        lpDenom: request.lpDenom,
      })
    );

    return {
      txHash: broadcast.txhash,
      lpAmount: (afterLpBalance - beforeLpBalance).toString(),
    };
  }

  async singleAssetProvideDelegate(
    request: SingleAssetProvideDelegateRequest
  ): Promise<SingleAssetProvideDelegateResult> {
    const beforeDelegatedBalance = BigInt(
      await this.getDelegatedLpBalance({
        userAddress: request.userAddress,
        validatorAddress: request.validatorAddress,
        lpDenom: request.lpDenom,
      })
    );
    const inputCoinMetadata = await this.rest.move.metadata(request.inputDenom);
    const simulationMsg = buildProvideDelegateMsg({
      grantee: this.keeperAddress,
      userAddress: request.userAddress,
      moduleAddress: request.moduleAddress,
      moduleName: request.moduleName,
      args: [
        bcs.object().serialize(request.targetPoolId).toBase64(),
        bcs.object().serialize(inputCoinMetadata).toBase64(),
        bcs.u64().serialize(BigInt(request.amount)).toBase64(),
        bcs.option(bcs.u64()).serialize(null).toBase64(),
        bcs.u64().serialize(BigInt(request.releaseTime)).toBase64(),
        bcs.string().serialize(request.validatorAddress).toBase64(),
      ],
    });
    const quotedLpAmount = await simulateQuotedLpAmount({
      rest: this.rest,
      wallet: this.wallet,
      msg: simulationMsg,
      targetPoolId: request.targetPoolId,
      lpDenom: request.lpDenom,
    });
    const minLiquidity = applySlippageBps(
      quotedLpAmount,
      request.maxSlippageBps
    );
    const msg = buildProvideDelegateMsg({
      grantee: this.keeperAddress,
      userAddress: request.userAddress,
      moduleAddress: request.moduleAddress,
      moduleName: request.moduleName,
      args: [
        bcs.object().serialize(request.targetPoolId).toBase64(),
        bcs.object().serialize(inputCoinMetadata).toBase64(),
        bcs.u64().serialize(BigInt(request.amount)).toBase64(),
        bcs.option(bcs.u64()).serialize(minLiquidity).toBase64(),
        bcs.u64().serialize(BigInt(request.releaseTime)).toBase64(),
        bcs.string().serialize(request.validatorAddress).toBase64(),
      ],
    });
    const signedTx = await this.wallet.createAndSignTx({
      msgs: [msg],
    });
    const broadcast = await this.rest.tx.broadcast(signedTx);

    if (isBroadcastError(broadcast)) {
      throw new Error(
        `Provide+delegate tx failed (${broadcast.code}): ${broadcast.raw_log}`
      );
    }

    const afterDelegatedBalance = BigInt(
      await this.getDelegatedLpBalance({
        userAddress: request.userAddress,
        validatorAddress: request.validatorAddress,
        lpDenom: request.lpDenom,
      })
    );
    const delegatedDelta = afterDelegatedBalance - beforeDelegatedBalance;

    return {
      txHash: broadcast.txhash,
      lpAmount: (delegatedDelta > 0n ? delegatedDelta : quotedLpAmount).toString(),
    };
  }

  async delegateLp(request: DelegateLpRequest): Promise<DelegateLpResult> {
    const msg = buildDelegateLpMsg({
      grantee: this.keeperAddress,
      userAddress: request.userAddress,
      validatorAddress: request.validatorAddress,
      lpDenom: request.lpDenom,
      amount: request.amount,
    });
    const signedTx = await this.wallet.createAndSignTx({
      msgs: [msg],
    });
    const broadcast = await this.rest.tx.broadcast(signedTx);

    if (isBroadcastError(broadcast)) {
      throw new Error(`Delegate tx failed (${broadcast.code}): ${broadcast.raw_log}`);
    }

    return {
      txHash: broadcast.txhash,
    };
  }

  async isTxConfirmed(txHash: string): Promise<boolean> {
    try {
      await this.rest.tx.txInfo(txHash);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }

      throw error;
    }
  }
}

export function createLiveKeeperChainClient(
  input: CreateLiveKeeperChainClientInput
) {
  const key = RawKey.fromHex(input.privateKey);
  const rest: RestClientLike =
    input.restClient
      ? input.restClient
      : new RESTClient(input.lcdUrl, {
          gasPrices: input.gasPrices,
          gasAdjustment: input.gasAdjustment,
        } satisfies RESTClientConfig);
  const wallet =
    input.wallet
    ?? new Wallet(rest as RESTClient, key);
  const signerAddress =
    input.wallet && "accAddress" in input.wallet && typeof input.wallet.accAddress === "string"
      ? input.wallet.accAddress
      : key.accAddress;

  return new LiveKeeperChainClient(rest, wallet, input.keeperAddress, signerAddress);
}
