import {
  ExecutionsRepository,
  PositionsRepository,
  StrategiesRepository
} from "@stacker/db";
import { getDelegatedLpKind } from "./position-mode.js";
import { parseRewardLockSnapshot } from "./reward-lock.js";

function sumBigIntStrings(values: string[]) {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

export class PositionsService {
  constructor(
    private readonly positionsRepository: PositionsRepository,
    private readonly strategiesRepository: StrategiesRepository,
    private readonly executionsRepository: ExecutionsRepository
  ) {}

  async listByUserId(userId: string) {
    const positions = await this.positionsRepository.listByUserId(userId);
    const strategies = await this.strategiesRepository.findByUserId(userId);
    const strategiesById = new Map(
      strategies.map((strategy) => [strategy.id, strategy])
    );
    const delegatedLpKind = getDelegatedLpKind();

    return positions.map((position) => ({
      inputDenom: strategiesById.get(position.strategyId)?.inputDenom ?? null,
      strategyId: position.strategyId,
      targetPoolId: strategiesById.get(position.strategyId)?.targetPoolId ?? null,
      validatorAddress:
        strategiesById.get(position.strategyId)?.validatorAddress ?? null,
      executionMode: "single-asset-provide-delegate" as const,
      delegatedLpKind,
      lastInputBalance: position.lastInputBalance,
      lastLpBalance: position.lastLpBalance,
      lastDelegatedLpBalance: position.lastDelegatedLpBalance,
      lastRewardSnapshot: position.lastRewardSnapshot,
      rewardLock: parseRewardLockSnapshot(position.lastRewardSnapshot),
      lastSyncedAt: position.lastSyncedAt.toISOString()
    }));
  }

  async getMerchantBalance(userId: string, apyBps: number) {
    const [positions, executions] = await Promise.all([
      this.positionsRepository.listByUserId(userId),
      this.executionsRepository.listByUserId(userId)
    ]);

    const principalAvailable = sumBigIntStrings(
      positions.map((position) => position.lastInputBalance)
    );
    const principalStaked = sumBigIntStrings(
      executions
        .filter(
          (execution) =>
            execution.status === "success" || execution.status === "simulated"
        )
        .map((execution) => execution.inputAmount)
    );

    return {
      principal_available: principalAvailable,
      principal_staked: principalStaked,
      yield_earned: "0",
      apy_bps: apyBps
    };
  }
}
