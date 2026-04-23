import { describe, expect, it } from "vitest";
import { createKeeperRunner } from "../src/runner/keeper-runner.js";
import { StrategyLocks } from "../src/runner/locks.js";
import { createKeeperFixture, Deferred } from "./support/in-memory.js";

const now = new Date("2026-04-23T12:00:00.000Z");
const baseStrategy = createKeeperFixture().strategies[0]!;
const baseGrant = createKeeperFixture().grants[0]!;

describe("keeper runner", () => {
  it("skips a strategy when the input balance is below threshold", async () => {
    const fixture = createKeeperFixture({
      chainState: {
        inputBalance: "50",
        lpBalance: "0",
        delegatedLpBalance: "0"
      }
    });

    const runner = createKeeperRunner({
      now: () => now,
      usersRepository: fixture.usersRepository,
      strategiesRepository: fixture.strategiesRepository,
      grantsRepository: fixture.grantsRepository,
      executionsRepository: fixture.executionsRepository,
      positionsRepository: fixture.positionsRepository,
      chain: fixture.chain,
      locks: new StrategyLocks()
    });

    const result = await runner.runTick();

    expect(result[0]).toMatchObject({
      strategyId: "strategy-1",
      outcome: "skipped",
      reason: "below-threshold"
    });
    expect(fixture.chain.provideCalls).toBe(0);
    expect(fixture.executionsRepository.list()).toHaveLength(0);
  });

  it("skips a paused strategy", async () => {
    const fixture = createKeeperFixture({
      strategies: [
        {
          ...baseStrategy,
          status: "paused"
        }
      ]
    });

    const runner = createKeeperRunner({
      now: () => now,
      usersRepository: fixture.usersRepository,
      strategiesRepository: fixture.strategiesRepository,
      grantsRepository: fixture.grantsRepository,
      executionsRepository: fixture.executionsRepository,
      positionsRepository: fixture.positionsRepository,
      chain: fixture.chain,
      locks: new StrategyLocks()
    });

    const result = await runner.runTick();

    expect(result[0]).toMatchObject({
      strategyId: "strategy-1",
      outcome: "skipped",
      reason: "not-runnable"
    });
    expect(fixture.chain.provideCalls).toBe(0);
  });

  it("marks a strategy expired when grants are no longer valid", async () => {
    const fixture = createKeeperFixture({
      grants: [
        {
          ...baseGrant,
          moveGrantExpiresAt: new Date("2026-04-01T00:00:00.000Z")
        }
      ]
    });

    const runner = createKeeperRunner({
      now: () => now,
      usersRepository: fixture.usersRepository,
      strategiesRepository: fixture.strategiesRepository,
      grantsRepository: fixture.grantsRepository,
      executionsRepository: fixture.executionsRepository,
      positionsRepository: fixture.positionsRepository,
      chain: fixture.chain,
      locks: new StrategyLocks()
    });

    const result = await runner.runTick();

    expect(result[0]).toMatchObject({
      strategyId: "strategy-1",
      outcome: "skipped",
      reason: "grant-expired"
    });
    expect(fixture.strategiesRepository.getById("strategy-1")?.status).toBe("expired");
    expect(fixture.chain.provideCalls).toBe(0);
  });

  it("prevents concurrent execution with the strategy lock", async () => {
    const deferred = new Deferred<{
      txHash: string;
      lpAmount: string;
    }>();
    const fixture = createKeeperFixture({
      chainState: {
        inputBalance: "500",
        lpBalance: "250",
        delegatedLpBalance: "250",
        providePromise: deferred.promise,
        delegateResult: {
          txHash: "delegate-1"
        }
      }
    });
    const locks = new StrategyLocks();
    const runner = createKeeperRunner({
      now: () => now,
      usersRepository: fixture.usersRepository,
      strategiesRepository: fixture.strategiesRepository,
      grantsRepository: fixture.grantsRepository,
      executionsRepository: fixture.executionsRepository,
      positionsRepository: fixture.positionsRepository,
      chain: fixture.chain,
      locks
    });

    const firstRun = runner.runTick();
    const secondRun = runner.runTick();

    await Promise.resolve();
    deferred.resolve({
      txHash: "provide-1",
      lpAmount: "250"
    });

    await Promise.all([firstRun, secondRun]);

    expect(fixture.chain.provideCalls).toBe(1);
  });

  it("moves to partial lp when provide succeeds but no lp delta is observed yet", async () => {
    const fixture = createKeeperFixture({
      chainState: {
        inputBalance: "500",
        lpBalance: "0",
        delegatedLpBalance: "0",
        provideResult: {
          txHash: "provide-1",
          lpAmount: "0"
        },
        delegateResult: {
          txHash: "delegate-1"
        }
      }
    });

    const runner = createKeeperRunner({
      now: () => now,
      usersRepository: fixture.usersRepository,
      strategiesRepository: fixture.strategiesRepository,
      grantsRepository: fixture.grantsRepository,
      executionsRepository: fixture.executionsRepository,
      positionsRepository: fixture.positionsRepository,
      chain: fixture.chain,
      locks: new StrategyLocks()
    });

    const result = await runner.runTick();

    expect(result[0]).toMatchObject({
      strategyId: "strategy-1",
      outcome: "skipped",
      reason: "missing-liquidity"
    });
    expect(fixture.chain.delegateCalls).toBe(0);
    expect(fixture.executionsRepository.list()[0]).toMatchObject({
      status: "retryable",
      provideTxHash: "provide-1",
      lpAmount: "0",
      errorCode: "LP_NOT_FOUND"
    });
    expect(fixture.strategiesRepository.getById("strategy-1")?.status).toBe("partial_lp");
  });

  it("skips a strategy while cooldown is still active", async () => {
    const fixture = createKeeperFixture({
      strategies: [
        {
          ...baseStrategy,
          nextEligibleAt: new Date("2026-04-23T13:00:00.000Z")
        }
      ]
    });

    const runner = createKeeperRunner({
      now: () => now,
      usersRepository: fixture.usersRepository,
      strategiesRepository: fixture.strategiesRepository,
      grantsRepository: fixture.grantsRepository,
      executionsRepository: fixture.executionsRepository,
      positionsRepository: fixture.positionsRepository,
      chain: fixture.chain,
      locks: new StrategyLocks()
    });

    const result = await runner.runTick();

    expect(result).toEqual([]);
    expect(fixture.chain.provideCalls).toBe(0);
  });

  it("uses the combined single-asset provide+delegate path in reward mode", async () => {
    const fixture = createKeeperFixture({
      chainState: {
        inputBalance: "500",
        lpBalance: "0",
        delegatedLpBalance: "0",
        bondedLockedLpBalance: "250",
        provideDelegateResult: {
          txHash: "provide-delegate-1",
          lpAmount: "250"
        }
      }
    });

    const runner = createKeeperRunner({
      now: () => now,
      usersRepository: fixture.usersRepository,
      strategiesRepository: fixture.strategiesRepository,
      grantsRepository: fixture.grantsRepository,
      executionsRepository: fixture.executionsRepository,
      positionsRepository: fixture.positionsRepository,
      chain: fixture.chain,
      locks: new StrategyLocks(),
      executionMode: "single-asset-provide-delegate",
      lockStakingModuleAddress: "0xlock",
      lockStakingModuleName: "lock_staking",
      lockupSeconds: "86400"
    });

    const result = await runner.runTick();

    expect(result[0]).toMatchObject({
      strategyId: "strategy-1",
      outcome: "executed",
      reason: "success"
    });
    expect(fixture.chain.provideDelegateCalls).toBe(1);
    expect(fixture.chain.provideCalls).toBe(0);
    expect(fixture.chain.delegateCalls).toBe(0);
    expect(fixture.executionsRepository.list()[0]).toMatchObject({
      status: "success",
      provideTxHash: "provide-delegate-1",
      delegateTxHash: "provide-delegate-1",
      lpAmount: "250"
    });
    expect(fixture.positionsRepository.list()[0]).toMatchObject({
      lastInputBalance: "500",
      lastLpBalance: "0",
      lastDelegatedLpBalance: "250",
      lastRewardSnapshot: JSON.stringify({
        kind: "bonded-locked",
        stakingAccount: "0xdryrunstakingaccount",
        metadata: "pool-1",
        releaseTime: "1777032000",
        releaseTimeIso: "2026-04-24T12:00:00.000Z",
        validatorAddress: "initvaloper1validator",
        lockedShare: "250"
      })
    });
  });
});
