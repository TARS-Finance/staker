import {
  ExecutionsRepository,
  GrantsRepository,
  PositionsRepository,
  StrategiesRepository
} from "@stacker/db";
import type { ApiConfig } from "../config.js";
import { getDelegatedLpKind } from "./position-mode.js";
import { parseRewardLockSnapshot } from "./reward-lock.js";

export type CreateStrategyInput = {
  userId: string;
  inputDenom: "usdc" | "iusdc";
  targetPoolId: string;
  validatorAddress: string;
  minBalanceAmount: string;
  maxAmountPerRun: string;
  maxSlippageBps: number;
  cooldownSeconds: number;
};

export class StrategiesService {
  constructor(
    private readonly strategiesRepository: StrategiesRepository,
    private readonly grantsRepository: GrantsRepository,
    private readonly positionsRepository: PositionsRepository,
    private readonly executionsRepository: ExecutionsRepository,
    private readonly config: ApiConfig
  ) {}

  async create(input: CreateStrategyInput) {
    return this.strategiesRepository.create({
      userId: input.userId,
      status: "grant_pending",
      inputDenom: input.inputDenom,
      targetPoolId: input.targetPoolId,
      dexModuleAddress: this.config.dexModuleAddress,
      dexModuleName: this.config.dexModuleName,
      validatorAddress: input.validatorAddress,
      minBalanceAmount: input.minBalanceAmount,
      maxAmountPerRun: input.maxAmountPerRun,
      maxSlippageBps: String(input.maxSlippageBps),
      cooldownSeconds: String(input.cooldownSeconds)
    });
  }

  async getStatus(strategyId: string) {
    const strategy = await this.strategiesRepository.findById(strategyId);

    if (!strategy) {
      return null;
    }

    const grant = await this.grantsRepository.findByUserId(strategy.userId);
    const position = await this.positionsRepository.findByStrategyId(strategy.id);
    const lastExecution =
      await this.executionsRepository.findLatestForStrategy(strategy.id);

    return {
      strategyId: strategy.id,
      status: strategy.status,
      executionMode: "single-asset-provide-delegate" as const,
      grantStatus: {
        move: grant?.moveGrantStatus ?? "pending",
        staking: "not-required" as const,
        feegrant: grant?.feegrantStatus ?? "pending",
        expiresAt: grant?.moveGrantExpiresAt?.toISOString() ?? null
      },
      balances: {
        input: position?.lastInputBalance ?? "0",
        lp: position?.lastLpBalance ?? "0",
        delegatedLp: position?.lastDelegatedLpBalance ?? "0",
        delegatedLpKind: getDelegatedLpKind()
      },
      rewardLock: parseRewardLockSnapshot(position?.lastRewardSnapshot ?? null),
      lastExecution: lastExecution
        ? {
            status: lastExecution.status,
            provideTxHash: lastExecution.provideTxHash,
            delegateTxHash: lastExecution.delegateTxHash,
            finishedAt: lastExecution.finishedAt?.toISOString()
          }
        : null
    };
  }
}
