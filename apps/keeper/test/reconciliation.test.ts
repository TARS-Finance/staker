import { describe, expect, it } from "vitest";
import { createKeeperRunner } from "../src/runner/keeper-runner.js";
import { StrategyLocks } from "../src/runner/locks.js";
import { createKeeperFixture } from "./support/in-memory.js";

const now = new Date("2026-04-23T12:00:00.000Z");
const baseStrategy = createKeeperFixture().strategies[0]!;

describe("keeper reconciliation", () => {
  it("retries delegation only after provide succeeded previously", async () => {
    const fixture = createKeeperFixture({
      chainState: {
        inputBalance: "500",
        lpBalance: "250",
        delegatedLpBalance: "250",
        provideResult: {
          txHash: "provide-1",
          lpAmount: "250"
        },
        delegateError: new Error("delegate failed")
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

    await runner.runTick();

    fixture.chain.state.delegateError = undefined;
    fixture.chain.state.delegateResult = {
      txHash: "delegate-2"
    };

    await runner.runTick();

    expect(fixture.chain.provideCalls).toBe(1);
    expect(fixture.chain.delegateCalls).toBe(2);
    expect(fixture.executionsRepository.list()[0]?.status).toBe("success");
    expect(fixture.strategiesRepository.getById("strategy-1")?.status).toBe("active");
  });

  it("does not double-send when a provide tx exists but is not confirmed yet", async () => {
    const fixture = createKeeperFixture({
      strategies: [
        {
          ...baseStrategy,
          status: "partial_lp"
        }
      ],
      executions: [
        {
          id: "execution-1",
          strategyId: "strategy-1",
          userId: "user-1",
          status: "retryable",
          inputAmount: "500",
          lpAmount: null,
          provideTxHash: "provide-1",
          delegateTxHash: null,
          errorCode: null,
          errorMessage: null,
          startedAt: now,
          finishedAt: null
        }
      ],
      chainState: {
        inputBalance: "500",
        lpBalance: "0",
        delegatedLpBalance: "0",
        txConfirmations: {
          "provide-1": false
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
      outcome: "skipped",
      reason: "provide-pending-confirmation"
    });
    expect(fixture.chain.provideCalls).toBe(0);
    expect(fixture.chain.delegateCalls).toBe(0);
  });

  it("syncs position balances after a successful execution", async () => {
    const fixture = createKeeperFixture({
      chainState: {
        inputBalance: "500",
        lpBalance: "250",
        delegatedLpBalance: "250",
        provideResult: {
          txHash: "provide-1",
          lpAmount: "250"
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

    await runner.runTick();

    expect(fixture.positionsRepository.list()).toEqual([
      expect.objectContaining({
        strategyId: "strategy-1",
        lastInputBalance: "500",
        lastLpBalance: "250",
        lastDelegatedLpBalance: "250"
      })
    ]);
  });
});
