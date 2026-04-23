import { describe, expect, it } from "vitest";
import { createDryRunKeeperChainClient } from "@stacker/chain";
import { createKeeperRunner } from "../src/runner/keeper-runner.js";
import { StrategyLocks } from "../src/runner/locks.js";
import { createKeeperFixture } from "./support/in-memory.js";

const now = new Date("2026-04-23T12:00:00.000Z");

describe("keeper dry-run mode", () => {
  it("selects eligible users, builds messages, avoids live broadcasts, and records a simulated execution", async () => {
    const fixture = createKeeperFixture();
    const chain = createDryRunKeeperChainClient({
      keeperAddress: "init1replacekeeperaddress",
      lpDenom: "ulp",
      startingBalances: {
        "init1useraddress:usdc": "500",
        "init1useraddress:ulp": "0",
        "init1useraddress:initvaloper1validator:ulp": "0"
      }
    });

    const runner = createKeeperRunner({
      now: () => now,
      usersRepository: fixture.usersRepository,
      strategiesRepository: fixture.strategiesRepository,
      grantsRepository: fixture.grantsRepository,
      executionsRepository: fixture.executionsRepository,
      positionsRepository: fixture.positionsRepository,
      chain,
      locks: new StrategyLocks(),
      lpDenom: "ulp"
    });

    const results = await runner.runTick();

    expect(results).toEqual([
      {
        strategyId: "strategy-1",
        outcome: "executed",
        reason: "success"
      }
    ]);
    expect(chain.mode).toBe("dry-run");
    expect(chain.broadcastCalls).toBe(0);
    expect(chain.getPlannedMessages()).toHaveLength(2);
    expect(chain.getPlannedMessages().map((message) => message["@type"])).toEqual([
      "/cosmos.authz.v1beta1.MsgExec",
      "/cosmos.authz.v1beta1.MsgExec"
    ]);
    expect(fixture.executionsRepository.list()[0]).toMatchObject({
      status: "simulated",
      provideTxHash: "dry-run-provide-1",
      delegateTxHash: "dry-run-delegate-2"
    });
  });
});
