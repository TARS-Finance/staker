import type { WithdrawalsRepository } from "@stacker/db";
import type { StrategiesRepository } from "@stacker/db";
import type { ChainService } from "./chain-service.js";

export class WithdrawalsService {
  constructor(
    private readonly withdrawalsRepository: WithdrawalsRepository,
    private readonly strategiesRepository: StrategiesRepository,
    private readonly chainService: ChainService,
    private readonly chainConfig: {
      lockStakingModuleAddress: string;
      lockStakingModuleName: string;
      chainId: string;
      explorerBase: string;
    }
  ) {}

  async createWithdrawal(input: {
    userId: string;
    initiaAddress: string;
    strategyId: string;
    inputAmount: string;
  }) {
    const strategy = await this.strategiesRepository.findById(input.strategyId);

    if (!strategy || strategy.userId !== input.userId) {
      throw Object.assign(new Error("Strategy not found"), { statusCode: 404 });
    }

    const inputBigInt = BigInt(input.inputAmount);
    if (inputBigInt <= 0n) {
      throw Object.assign(new Error("Input amount must be positive"), { statusCode: 400 });
    }

    let lpAmount: bigint;
    try {
      const poolInfo = await this.chainService.getPoolInfo(strategy.targetPoolId);
      lpAmount = this.chainService.computeLpFromInput(inputBigInt, poolInfo);
    } catch {
      // Fallback: 1:1 approximation if chain is unreachable
      lpAmount = inputBigInt;
    }

    if (lpAmount <= 0n) {
      throw Object.assign(new Error("Computed LP amount is zero; pool may be empty"), { statusCode: 400 });
    }

    const messages = this.chainService.buildWithdrawMessages({
      userAddress: input.initiaAddress,
      targetPoolId: strategy.targetPoolId,
      validatorAddress: strategy.validatorAddress,
      moduleAddress: this.chainConfig.lockStakingModuleAddress,
      moduleName: this.chainConfig.lockStakingModuleName,
      lpAmount,
    });

    const withdrawal = await this.withdrawalsRepository.create({
      userId: input.userId,
      strategyId: input.strategyId,
      inputAmount: input.inputAmount,
      lpAmount: lpAmount.toString(),
      status: "pending",
    });

    return {
      withdrawalId: withdrawal.id,
      lpAmount: lpAmount.toString(),
      messages,
      chainId: this.chainConfig.chainId,
    };
  }

  async confirmWithdrawal(input: {
    userId: string;
    withdrawalId: string;
    txHash: string;
    explorerBase?: string;
    chainId?: string;
  }) {
    const existing = await this.withdrawalsRepository.findById(input.withdrawalId);
    if (!existing || existing.userId !== input.userId) {
      throw Object.assign(new Error("Withdrawal not found"), { statusCode: 404 });
    }

    return this.withdrawalsRepository.update(input.withdrawalId, {
      status: "confirmed",
      txHash: input.txHash,
      confirmedAt: new Date(),
    });
  }

  async listWithdrawals(userId: string, explorerBase: string, chainId: string) {
    const rows = await this.withdrawalsRepository.listByUserId(userId);
    return rows.map((w) => ({
      id: w.id,
      strategyId: w.strategyId,
      inputAmount: w.inputAmount,
      lpAmount: w.lpAmount,
      status: w.status,
      txHash: w.txHash ?? null,
      requestedAt: w.requestedAt.toISOString(),
      confirmedAt: w.confirmedAt?.toISOString() ?? null,
      txUrl: w.txHash ? `${explorerBase}/${chainId}/txs/${w.txHash}` : null,
    }));
  }
}
