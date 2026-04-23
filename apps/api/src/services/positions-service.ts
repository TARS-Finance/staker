import { PositionsRepository } from "@stacker/db";

export class PositionsService {
  constructor(private readonly positionsRepository: PositionsRepository) {}

  async listByUserId(userId: string) {
    const positions = await this.positionsRepository.listByUserId(userId);

    return positions.map((position) => ({
      strategyId: position.strategyId,
      lastInputBalance: position.lastInputBalance,
      lastLpBalance: position.lastLpBalance,
      lastDelegatedLpBalance: position.lastDelegatedLpBalance,
      lastRewardSnapshot: position.lastRewardSnapshot,
      lastSyncedAt: position.lastSyncedAt.toISOString()
    }));
  }
}
