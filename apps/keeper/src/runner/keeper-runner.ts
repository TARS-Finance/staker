import {
  getBondedLockedLpBalance,
  reconcileDelegate,
  reconcileProvide,
  type KeeperChainClient,
  type KeeperMode,
  type StrategyExecutionMode,
} from "@stacker/chain";
import {
  computeNextEligibleAt,
  isGrantBundleActive,
  minBigIntString,
  serializeError,
} from "./retry-policy.js";
import { StrategyLocks } from "./locks.js";

type UserRecord = {
  id: string;
  initiaAddress: string;
};

type StrategyRecord = {
  id: string;
  userId: string;
  status:
    | "draft"
    | "grant_pending"
    | "active"
    | "executing"
    | "partial_lp"
    | "paused"
    | "expired"
    | "error";
  inputDenom: string;
  targetPoolId: string;
  dexModuleAddress: string;
  dexModuleName: string;
  validatorAddress: string;
  minBalanceAmount: string;
  maxAmountPerRun: string;
  maxSlippageBps: string;
  cooldownSeconds: string;
  lastExecutedAt: Date | null;
  nextEligibleAt: Date | null;
  pauseReason: string | null;
};

type GrantRecord = {
  userId: string;
  keeperAddress: string;
  moveGrantExpiresAt: Date | null;
  stakingGrantExpiresAt: Date | null;
  feegrantExpiresAt: Date | null;
  moveGrantStatus: "pending" | "active" | "revoked" | "expired";
  stakingGrantStatus: "pending" | "active" | "revoked" | "expired";
  feegrantStatus: "pending" | "active" | "revoked" | "expired";
};

type ExecutionRecord = {
  id: string;
  strategyId: string;
  userId: string;
  status:
    | "queued"
    | "providing"
    | "delegating"
    | "simulated"
    | "success"
    | "failed"
    | "retryable";
  inputAmount: string;
  lpAmount: string | null;
  provideTxHash: string | null;
  delegateTxHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

type PositionRecord = {
  strategyId: string;
  userId: string;
  lastInputBalance: string;
  lastLpBalance: string;
  lastDelegatedLpBalance: string;
  lastRewardSnapshot: string | null;
  lastSyncedAt: Date;
};

type KeeperDependencies = {
  now: () => Date;
  usersRepository: {
    findById(id: string): Promise<UserRecord | null>;
  };
  strategiesRepository: {
    findRunnableStrategies(now: Date): Promise<StrategyRecord[]>;
    patch(id: string, values: Partial<StrategyRecord>): Promise<StrategyRecord>;
  };
  grantsRepository: {
    findByUserId(userId: string): Promise<GrantRecord | null>;
  };
  executionsRepository: {
    create(values: Omit<ExecutionRecord, "id">): Promise<ExecutionRecord>;
    findLatestForStrategy(strategyId: string): Promise<ExecutionRecord | null>;
    update(
      id: string,
      values: Partial<ExecutionRecord>,
    ): Promise<ExecutionRecord>;
  };
  positionsRepository: {
    findByStrategyId(strategyId: string): Promise<PositionRecord | null>;
    upsertForStrategy(
      values: Omit<PositionRecord, "id"> & { id?: string },
    ): Promise<PositionRecord>;
  };
  chain: KeeperChainClient;
  locks?: StrategyLocks;
  lpDenom?: string;
  executionMode?: StrategyExecutionMode;
  lockStakingModuleAddress?: string;
  lockStakingModuleName?: string;
  lockupSeconds?: string;
};

export type TickResult = {
  strategyId: string;
  outcome: "executed" | "skipped";
  reason:
    | "success"
    | "below-threshold"
    | "not-runnable"
    | "grant-expired"
    | "locked"
    | "provide-pending-confirmation"
    | "missing-liquidity"
    | "provide-failed"
    | "delegate-failed";
};

function buildResult(
  strategyId: string,
  outcome: TickResult["outcome"],
  reason: TickResult["reason"],
): TickResult {
  return { strategyId, outcome, reason };
}

export function createKeeperRunner(dependencies: KeeperDependencies) {
  const locks = dependencies.locks ?? new StrategyLocks();
  const lpDenom = dependencies.lpDenom ?? "ulp";
  const executionMode =
    dependencies.executionMode ?? "provide-then-delegate";
  const executionStatusForCompletion = (
    mode: KeeperMode,
  ): "success" | "simulated" => (mode === "dry-run" ? "simulated" : "success");

  async function syncPosition(
    strategy: StrategyRecord,
    user: UserRecord,
    now: Date,
    rewardSnapshot?: string | null,
  ) {
    const existingPosition = await dependencies.positionsRepository.findByStrategyId(
      strategy.id,
    );

    if (executionMode === "single-asset-provide-delegate") {
      if (
        !dependencies.lockStakingModuleAddress
        || !dependencies.lockStakingModuleName
      ) {
        throw new Error(
          "Lock staking execution mode requires module address and module name."
        );
      }

      const [lastInputBalance, lastLpBalance, lastDelegatedLpBalance] =
        await Promise.all([
          dependencies.chain.getInputBalance({
            userAddress: user.initiaAddress,
            denom: strategy.inputDenom,
          }),
          dependencies.chain.getLpBalance({
            userAddress: user.initiaAddress,
            lpDenom,
          }),
          getBondedLockedLpBalance(dependencies.chain, {
            userAddress: user.initiaAddress,
            targetPoolId: strategy.targetPoolId,
            validatorAddress: strategy.validatorAddress,
            moduleAddress: dependencies.lockStakingModuleAddress,
            moduleName: dependencies.lockStakingModuleName,
          }),
        ]);

      await dependencies.positionsRepository.upsertForStrategy({
        strategyId: strategy.id,
        userId: strategy.userId,
        lastInputBalance,
        lastLpBalance,
        lastDelegatedLpBalance,
        lastRewardSnapshot:
          rewardSnapshot ?? existingPosition?.lastRewardSnapshot ?? null,
        lastSyncedAt: now,
      });

      return;
    }

    const balances = await reconcileDelegate(dependencies.chain, {
      userAddress: user.initiaAddress,
      inputDenom: strategy.inputDenom,
      lpDenom,
      validatorAddress: strategy.validatorAddress,
    });

    await dependencies.positionsRepository.upsertForStrategy({
      strategyId: strategy.id,
      userId: strategy.userId,
      lastInputBalance: balances.lastInputBalance,
      lastLpBalance: balances.lastLpBalance,
      lastDelegatedLpBalance: balances.lastDelegatedLpBalance,
      lastRewardSnapshot: existingPosition?.lastRewardSnapshot ?? null,
      lastSyncedAt: now,
    });
  }

  async function executeDelegateRetry(
    strategy: StrategyRecord,
    user: UserRecord,
    latestExecution: ExecutionRecord,
    now: Date,
  ): Promise<TickResult> {
    const position = await dependencies.positionsRepository.findByStrategyId(
      strategy.id,
    );

    if (latestExecution.delegateTxHash) {
      const delegateConfirmed = await dependencies.chain.isTxConfirmed(
        latestExecution.delegateTxHash,
      );

      if (!delegateConfirmed) {
        return buildResult(strategy.id, "skipped", "locked");
      }
    }

    const provideState = await reconcileProvide({
      chain: dependencies.chain,
      execution: latestExecution,
      userAddress: user.initiaAddress,
      lpDenom,
      lastKnownLpBalance: position?.lastLpBalance ?? "0",
    });

    if (provideState.status === "pending-confirmation") {
      return buildResult(
        strategy.id,
        "skipped",
        "provide-pending-confirmation",
      );
    }

    if (provideState.status === "missing-liquidity") {
      return buildResult(strategy.id, "skipped", "missing-liquidity");
    }

    try {
      const delegated = await dependencies.chain.delegateLp({
        userAddress: user.initiaAddress,
        validatorAddress: strategy.validatorAddress,
        lpDenom,
        amount: provideState.lpAmount,
      });

      await dependencies.executionsRepository.update(latestExecution.id, {
        status: executionStatusForCompletion(dependencies.chain.mode),
        lpAmount: provideState.lpAmount,
        delegateTxHash: delegated.txHash,
        errorCode: null,
        errorMessage: null,
        finishedAt: now,
      });
      await syncPosition(strategy, user, now);
      await dependencies.strategiesRepository.patch(strategy.id, {
        status: "active",
        lastExecutedAt: now,
        nextEligibleAt: computeNextEligibleAt(now, strategy.cooldownSeconds),
        pauseReason: null,
      });

      return buildResult(strategy.id, "executed", "success");
    } catch (error) {
      await dependencies.executionsRepository.update(latestExecution.id, {
        status: "retryable",
        lpAmount: provideState.lpAmount,
        errorCode: "DELEGATE_FAILED",
        errorMessage: serializeError(error),
      });
      await dependencies.strategiesRepository.patch(strategy.id, {
        status: "partial_lp",
      });

      return buildResult(strategy.id, "skipped", "delegate-failed");
    }
  }

  async function executeActiveStrategy(
    strategy: StrategyRecord,
    user: UserRecord,
    now: Date,
  ): Promise<TickResult> {
    const inputBalance = await dependencies.chain.getInputBalance({
      userAddress: user.initiaAddress,
      denom: strategy.inputDenom,
    });

    if (BigInt(inputBalance) < BigInt(strategy.minBalanceAmount)) {
      return buildResult(strategy.id, "skipped", "below-threshold");
    }

    const execution = await dependencies.executionsRepository.create({
      strategyId: strategy.id,
      userId: strategy.userId,
      status: "providing",
      inputAmount: minBigIntString(inputBalance, strategy.maxAmountPerRun),
      lpAmount: null,
      provideTxHash: null,
      delegateTxHash: null,
      errorCode: null,
      errorMessage: null,
      startedAt: now,
      finishedAt: null,
    });

    await dependencies.strategiesRepository.patch(strategy.id, {
      status: "executing",
    });

    try {
      if (executionMode === "single-asset-provide-delegate") {
        if (
          !dependencies.lockStakingModuleAddress
          || !dependencies.lockStakingModuleName
          || !dependencies.lockupSeconds
        ) {
          throw new Error(
            "Lock staking execution mode requires module address, module name, and lockup seconds."
          );
        }

        const releaseTime = Math.floor(now.getTime() / 1000)
          + Number(dependencies.lockupSeconds);
        const provided = await dependencies.chain.singleAssetProvideDelegate({
          userAddress: user.initiaAddress,
          targetPoolId: strategy.targetPoolId,
          inputDenom: strategy.inputDenom,
          lpDenom,
          amount: execution.inputAmount,
          maxSlippageBps: strategy.maxSlippageBps,
          moduleAddress: dependencies.lockStakingModuleAddress,
          moduleName: dependencies.lockStakingModuleName,
          releaseTime: String(releaseTime),
          validatorAddress: strategy.validatorAddress,
        });

        await dependencies.executionsRepository.update(execution.id, {
          status: executionStatusForCompletion(dependencies.chain.mode),
          provideTxHash: provided.txHash,
          delegateTxHash: provided.txHash,
          lpAmount: provided.lpAmount,
          finishedAt: now,
          errorCode: null,
          errorMessage: null,
        });
        await syncPosition(
          strategy,
          user,
          now,
          provided.rewardSnapshot
            ? JSON.stringify(provided.rewardSnapshot)
            : null,
        );
        await dependencies.strategiesRepository.patch(strategy.id, {
          status: "active",
          lastExecutedAt: now,
          nextEligibleAt: computeNextEligibleAt(now, strategy.cooldownSeconds),
          pauseReason: null,
        });

        return buildResult(strategy.id, "executed", "success");
      }

      const provided = await dependencies.chain.provideSingleAssetLiquidity({
        userAddress: user.initiaAddress,
        targetPoolId: strategy.targetPoolId,
        inputDenom: strategy.inputDenom,
        lpDenom,
        amount: execution.inputAmount,
        maxSlippageBps: strategy.maxSlippageBps,
        moduleAddress: strategy.dexModuleAddress,
        moduleName: strategy.dexModuleName,
      });

      await dependencies.executionsRepository.update(execution.id, {
        status: "delegating",
        provideTxHash: provided.txHash,
        lpAmount: provided.lpAmount,
      });

      if (BigInt(provided.lpAmount) <= 0n) {
        await dependencies.executionsRepository.update(execution.id, {
          status: "retryable",
          provideTxHash: provided.txHash,
          lpAmount: provided.lpAmount,
          errorCode: "LP_NOT_FOUND",
          errorMessage: "Provide tx completed but LP delta was not observed yet.",
        });
        await dependencies.strategiesRepository.patch(strategy.id, {
          status: "partial_lp",
        });

        return buildResult(strategy.id, "skipped", "missing-liquidity");
      }

      try {
        const delegated = await dependencies.chain.delegateLp({
          userAddress: user.initiaAddress,
          validatorAddress: strategy.validatorAddress,
          lpDenom,
          amount: provided.lpAmount,
        });

        await dependencies.executionsRepository.update(execution.id, {
          status: executionStatusForCompletion(dependencies.chain.mode),
          provideTxHash: provided.txHash,
          lpAmount: provided.lpAmount,
          delegateTxHash: delegated.txHash,
          finishedAt: now,
          errorCode: null,
          errorMessage: null,
        });
        await syncPosition(strategy, user, now);
        await dependencies.strategiesRepository.patch(strategy.id, {
          status: "active",
          lastExecutedAt: now,
          nextEligibleAt: computeNextEligibleAt(now, strategy.cooldownSeconds),
          pauseReason: null,
        });

        return buildResult(strategy.id, "executed", "success");
      } catch (error) {
        await dependencies.executionsRepository.update(execution.id, {
          status: "retryable",
          provideTxHash: provided.txHash,
          lpAmount: provided.lpAmount,
          errorCode: "DELEGATE_FAILED",
          errorMessage: serializeError(error),
        });
        await dependencies.strategiesRepository.patch(strategy.id, {
          status: "partial_lp",
        });

        return buildResult(strategy.id, "skipped", "delegate-failed");
      }
    } catch (error) {
      await dependencies.executionsRepository.update(execution.id, {
        status: "failed",
        errorCode: "PROVIDE_FAILED",
        errorMessage: serializeError(error),
        finishedAt: now,
      });
      await dependencies.strategiesRepository.patch(strategy.id, {
        status: "active",
        nextEligibleAt: computeNextEligibleAt(now, strategy.cooldownSeconds),
      });

      return buildResult(strategy.id, "skipped", "provide-failed");
    }
  }

  async function runStrategy(
    strategy: StrategyRecord,
    now: Date,
  ): Promise<TickResult> {
    if (strategy.status !== "active" && strategy.status !== "partial_lp") {
      return buildResult(strategy.id, "skipped", "not-runnable");
    }

    if (!locks.acquire(strategy.id)) {
      return buildResult(strategy.id, "skipped", "locked");
    }

    try {
      const user = await dependencies.usersRepository.findById(strategy.userId);
      const grant = await dependencies.grantsRepository.findByUserId(
        strategy.userId,
      );

      if (!user) {
        return buildResult(strategy.id, "skipped", "not-runnable");
      }

      if (!isGrantBundleActive(grant, now)) {
        await dependencies.strategiesRepository.patch(strategy.id, {
          status: "expired",
        });

        return buildResult(strategy.id, "skipped", "grant-expired");
      }

      if (strategy.status === "partial_lp") {
        const latestExecution =
          await dependencies.executionsRepository.findLatestForStrategy(
            strategy.id,
          );

        if (!latestExecution) {
          return buildResult(strategy.id, "skipped", "missing-liquidity");
        }

        return executeDelegateRetry(strategy, user, latestExecution, now);
      }

      return executeActiveStrategy(strategy, user, now);
    } finally {
      locks.release(strategy.id);
    }
  }

  return {
    locks,
    async runTick(): Promise<TickResult[]> {
      const now = dependencies.now();
      const strategies =
        await dependencies.strategiesRepository.findRunnableStrategies(now);
      const results: TickResult[] = [];

      for (const strategy of strategies) {
        results.push(await runStrategy(strategy, now));
      }

      return results;
    },
    runStrategy,
  };
}
