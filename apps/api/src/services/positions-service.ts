import { PositionsRepository, StrategiesRepository } from "@stacker/db";
import { getDelegatedLpKind } from "./position-mode.js";
import { parseRewardLockSnapshot } from "./reward-lock.js";

export class PositionsService {
  constructor(
    private readonly positionsRepository: PositionsRepository,
    private readonly strategiesRepository: StrategiesRepository
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
}
