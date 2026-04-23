import { delegateLp as buildDelegateLpMsg } from "../staking/delegate-lp.js";
import { provideSingleAssetLiquidity as buildProvideLiquidityMsg } from "../dex/provide-single-asset-liquidity.js";
import type {
  DelegateLpRequest,
  DelegateLpResult,
  KeeperChainClient,
  ProvideSingleAssetLiquidityRequest,
  ProvideSingleAssetLiquidityResult
} from "../query/types.js";

type DryRunInput = {
  keeperAddress: string;
  lpDenom: string;
  startingBalances?: Record<string, string>;
  defaultInputBalance?: string;
};

type PlannedMessage = {
  "@type": string;
};

function userBalanceKey(userAddress: string, denom: string): string {
  return `${userAddress}:${denom}`;
}

function delegatedBalanceKey(
  userAddress: string,
  validatorAddress: string,
  denom: string
): string {
  return `${userAddress}:${validatorAddress}:${denom}`;
}

function encodeProvideArgs(input: ProvideSingleAssetLiquidityRequest): string[] {
  return [
    Buffer.from(
      JSON.stringify({
        targetPoolId: input.targetPoolId,
        inputDenom: input.inputDenom,
        amount: input.amount,
        maxSlippageBps: input.maxSlippageBps
      }),
      "utf8"
    ).toString("base64")
  ];
}

export class DryRunKeeperChainClient implements KeeperChainClient {
  readonly mode = "dry-run" as const;
  readonly broadcastCalls = 0;
  private readonly plannedMessages: PlannedMessage[] = [];
  private readonly balances = new Map<string, bigint>();
  private txSequence = 0;

  constructor(private readonly input: DryRunInput) {
    Object.entries(input.startingBalances ?? {}).forEach(([key, value]) => {
      this.balances.set(key, BigInt(value));
    });
  }

  getPlannedMessages(): PlannedMessage[] {
    return [...this.plannedMessages];
  }

  async getInputBalance(request: {
    userAddress: string;
    denom: string;
  }): Promise<string> {
    const key = userBalanceKey(request.userAddress, request.denom);
    const value =
      this.balances.get(key)
      ?? (request.denom === this.input.lpDenom
        ? 0n
        : BigInt(this.input.defaultInputBalance ?? "0"));

    return value.toString();
  }

  async getLpBalance(request: {
    userAddress: string;
    lpDenom: string;
  }): Promise<string> {
    const key = userBalanceKey(request.userAddress, request.lpDenom);
    return (this.balances.get(key) ?? 0n).toString();
  }

  async getDelegatedLpBalance(request: {
    userAddress: string;
    validatorAddress: string;
    lpDenom: string;
  }): Promise<string> {
    const key = delegatedBalanceKey(
      request.userAddress,
      request.validatorAddress,
      request.lpDenom
    );

    return (this.balances.get(key) ?? 0n).toString();
  }

  async provideSingleAssetLiquidity(
    request: ProvideSingleAssetLiquidityRequest
  ): Promise<ProvideSingleAssetLiquidityResult> {
    const inputKey = userBalanceKey(request.userAddress, request.inputDenom);
    const lpKey = userBalanceKey(request.userAddress, this.input.lpDenom);
    const currentInput = BigInt(await this.getInputBalance({
      userAddress: request.userAddress,
      denom: request.inputDenom
    }));
    const amount = BigInt(request.amount);

    if (currentInput < amount) {
      throw new Error("Insufficient dry-run balance");
    }

    this.balances.set(inputKey, currentInput - amount);
    this.balances.set(lpKey, (this.balances.get(lpKey) ?? 0n) + amount);
    this.plannedMessages.push(
      buildProvideLiquidityMsg({
        grantee: this.input.keeperAddress,
        userAddress: request.userAddress,
        moduleAddress: request.moduleAddress,
        moduleName: request.moduleName,
        args: encodeProvideArgs(request)
      }).toData()
    );

    const txHash = `dry-run-provide-${++this.txSequence}`;

    return {
      txHash,
      lpAmount: amount.toString()
    };
  }

  async delegateLp(request: DelegateLpRequest): Promise<DelegateLpResult> {
    const lpKey = userBalanceKey(request.userAddress, request.lpDenom);
    const delegatedKey = delegatedBalanceKey(
      request.userAddress,
      request.validatorAddress,
      request.lpDenom
    );
    const currentLp = BigInt(await this.getLpBalance({
      userAddress: request.userAddress,
      lpDenom: request.lpDenom
    }));
    const amount = BigInt(request.amount);

    if (currentLp < amount) {
      throw new Error("Insufficient dry-run LP balance");
    }

    this.balances.set(lpKey, currentLp - amount);
    this.balances.set(
      delegatedKey,
      (this.balances.get(delegatedKey) ?? 0n) + amount
    );
    this.plannedMessages.push(
      buildDelegateLpMsg({
        grantee: this.input.keeperAddress,
        userAddress: request.userAddress,
        validatorAddress: request.validatorAddress,
        lpDenom: request.lpDenom,
        amount: request.amount
      }).toData()
    );

    return {
      txHash: `dry-run-delegate-${++this.txSequence}`
    };
  }

  async isTxConfirmed(): Promise<boolean> {
    return true;
  }
}

export function createDryRunKeeperChainClient(input: DryRunInput) {
  return new DryRunKeeperChainClient(input);
}
