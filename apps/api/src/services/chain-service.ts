import { bcs, RESTClient } from "@initia/initia.js";
import { bech32 } from "bech32";

type PoolInfo = {
  coinAAmount: bigint;
  coinBAmount: bigint;
  totalShare: bigint;
};

function parseU64(value: unknown): bigint {
  if (typeof value === "string") return BigInt(value);
  if (typeof value === "number") return BigInt(value);
  return 0n;
}

function extractPoolInfo(raw: unknown): PoolInfo {
  // viewFunction may return the struct directly or wrapped in {data: {...}}
  const obj =
    raw && typeof raw === "object" && "data" in (raw as object)
      ? (raw as { data: unknown }).data
      : raw;

  if (!obj || typeof obj !== "object") {
    throw new Error(`Unexpected pool info shape: ${JSON.stringify(raw)}`);
  }

  const r = obj as Record<string, unknown>;

  return {
    coinAAmount: parseU64(r["coin_a_amount"]),
    coinBAmount: parseU64(r["coin_b_amount"]),
    totalShare: parseU64(r["total_share"]),
  };
}

export type WithdrawMessage = {
  typeUrl: string;
  value: Record<string, unknown>;
};

function hexToBech32(hex: string, prefix = "init"): string {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = Buffer.from(stripped, "hex");
  const words = bech32.toWords(bytes);
  return bech32.encode(prefix, words);
}

export class ChainService {
  constructor(private readonly rest: RESTClient) {}

  async getPoolInfo(poolId: string): Promise<PoolInfo> {
    const viewFn = (this.rest.move as unknown as {
      viewFunction(
        addr: string,
        module: string,
        fn: string,
        typeArgs: string[],
        args: string[]
      ): Promise<unknown>;
    }).viewFunction;

    if (!viewFn) {
      throw new Error("REST client does not support Move view functions");
    }

    const response = await viewFn.call(this.rest.move, "0x1", "dex", "get_pool_info", [], [
      bcs.object().serialize(poolId).toBase64(),
    ]);

    return extractPoolInfo(response);
  }

  async getBondedLockedLpAmount(input: {
    keeperAddress: string;
    targetPoolId: string;
    validatorAddress: string;
    moduleAddress: string;
    moduleName: string;
  }): Promise<bigint> {
    const viewFn = (this.rest.move as unknown as {
      viewFunction(
        addr: string,
        module: string,
        fn: string,
        typeArgs: string[],
        args: string[]
      ): Promise<unknown>;
    }).viewFunction;

    if (!viewFn) return 0n;

    try {
      const response = await viewFn.call(
        this.rest.move,
        input.moduleAddress,
        input.moduleName,
        "get_bonded_locked_delegations",
        [],
        [bcs.address().serialize(input.keeperAddress).toBase64()]
      );

      const items = Array.isArray(response)
        ? response
        : Array.isArray((response as { data?: unknown[] })?.data)
          ? (response as { data: unknown[] }).data
          : [];

      const targetPoolId = input.targetPoolId.toLowerCase();
      let total = 0n;

      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const r = item as Record<string, unknown>;
        const metadata = typeof r["metadata"] === "string" ? r["metadata"].toLowerCase() : null;
        const validator = typeof r["validator"] === "string" ? r["validator"] : null;
        const amount = typeof r["amount"] === "string" ? r["amount"] : null;

        if (metadata !== targetPoolId || validator !== input.validatorAddress || !amount) continue;
        total += BigInt(amount);
      }

      return total;
    } catch {
      return 0n;
    }
  }

  /**
   * Compute yield earned in micro-input-denom units.
   *
   * For a 20/80 USDC/INIT pool: LP price in USDC = (coinA_amount * 5) / total_share
   * yield = max(0, currentLpValueInUSDC - principalStaked)
   */
  async computeYieldEarned(input: {
    keeperAddress: string;
    targetPoolId: string;
    validatorAddress: string;
    moduleAddress: string;
    moduleName: string;
    principalStaked: bigint;
    coinAWeightReciprocal?: bigint; // 5 for 20/80 pool (1/0.2 = 5)
  }): Promise<bigint> {
    try {
      const [poolInfo, bondedLp] = await Promise.all([
        this.getPoolInfo(input.targetPoolId),
        this.getBondedLockedLpAmount({
          keeperAddress: input.keeperAddress,
          targetPoolId: input.targetPoolId,
          validatorAddress: input.validatorAddress,
          moduleAddress: input.moduleAddress,
          moduleName: input.moduleName,
        }),
      ]);

      if (poolInfo.totalShare === 0n || bondedLp === 0n) return 0n;

      const weightReciprocal = input.coinAWeightReciprocal ?? 5n;
      // LP value in micro-coinA = (bondedLp * coinA_amount * weightReciprocal) / total_share
      const lpValueInCoinA =
        (bondedLp * poolInfo.coinAAmount * weightReciprocal) / poolInfo.totalShare;

      const yield_ = lpValueInCoinA > input.principalStaked
        ? lpValueInCoinA - input.principalStaked
        : 0n;

      return yield_;
    } catch {
      return 0n;
    }
  }

  /**
   * Compute the LP share amount for a given USDC input amount.
   * Inverse of the LP price formula: LP = inputAmount * totalShare / (coinAAmount * weightReciprocal)
   */
  computeLpFromInput(
    inputAmount: bigint,
    poolInfo: PoolInfo,
    coinAWeightReciprocal = 5n
  ): bigint {
    if (poolInfo.coinAAmount === 0n) return 0n;
    return (inputAmount * poolInfo.totalShare) / (poolInfo.coinAAmount * coinAWeightReciprocal);
  }

  /**
   * Build the MsgExecute message for lock_staking::unlock_and_undelegate.
   * Args are BCS-encoded base64 strings ready for InterwovenKit.
   */
  buildWithdrawMessages(input: {
    userAddress: string;
    targetPoolId: string;
    validatorAddress: string;
    moduleAddress: string;
    moduleName: string;
    lpAmount: bigint;
  }): WithdrawMessage[] {
    const moduleAddressBech32 = hexToBech32(input.moduleAddress);
    return [
      {
        typeUrl: "/initia.move.v1.MsgExecute",
        value: {
          sender: input.userAddress,
          moduleAddress: moduleAddressBech32,
          moduleName: input.moduleName,
          functionName: "unlock_and_undelegate",
          typeArgs: [],
          args: [
            bcs.object().serialize(input.targetPoolId).toBase64(),
            bcs.string().serialize(input.validatorAddress).toBase64(),
            bcs.u64().serialize(input.lpAmount).toBase64(),
          ],
        },
      },
    ];
  }
}
