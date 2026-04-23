import { PositionsRepository, StrategiesRepository } from "@stacker/db";
import type { ApiConfig } from "../config.js";
import { getDelegatedLpKind } from "./position-mode.js";
import { parseRewardLockSnapshot } from "./reward-lock.js";

export class PositionsService {
  constructor(
    private readonly positionsRepository: PositionsRepository,
    private readonly strategiesRepository: StrategiesRepository,
    private readonly config: ApiConfig
  ) {}

  async listByUserId(userId: string) {
    const positions = await this.positionsRepository.listByUserId(userId);
    const strategies = await this.strategiesRepository.findByUserId(userId);
    const strategiesById = new Map(
      strategies.map((strategy) => [strategy.id, strategy])
    );
    const delegatedLpKind = getDelegatedLpKind(this.config.executionMode);

    return positions.map((position) => ({
      inputDenom: strategiesById.get(position.strategyId)?.inputDenom ?? null,
      strategyId: position.strategyId,
      targetPoolId: strategiesById.get(position.strategyId)?.targetPoolId ?? null,
      validatorAddress:
        strategiesById.get(position.strategyId)?.validatorAddress ?? null,
      executionMode: this.config.executionMode,
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
