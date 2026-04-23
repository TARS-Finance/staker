import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { positions } from "@stacker/db";
import { createApp } from "../src/app.js";

describe("stacker api", () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    app = await createApp({
      config: {
        lockStakingModuleAddress: "0xlock",
        lockStakingModuleName: "lock_staking",
        lockupSeconds: "86400"
      }
    });
    await app.ready();
  });

  beforeEach(async () => {
    await app.db.execute(`
      truncate table executions, positions, grants, strategies, users
      restart identity cascade;
    `);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("registers a user, creates a strategy, prepares and confirms grants, and reads status/history", async () => {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/users/register",
      payload: {
        initiaAddress: "init1useraddress"
      }
    });

    expect(registerResponse.statusCode).toBe(201);

    const registerBody = registerResponse.json<{
      userId: string;
      initiaAddress: string;
    }>();

    expect(registerBody.initiaAddress).toBe("init1useraddress");

    const strategyResponse = await app.inject({
      method: "POST",
      url: "/strategies",
      payload: {
        userId: registerBody.userId,
        inputDenom: "usdc",
        targetPoolId: "pool-1",
        validatorAddress: "initvaloper1validator",
        minBalanceAmount: "100",
        maxAmountPerRun: "1000",
        maxSlippageBps: 100,
        cooldownSeconds: 300
      }
    });

    expect(strategyResponse.statusCode).toBe(201);

    const strategyBody = strategyResponse.json<{
      strategyId: string;
      status: string;
    }>();

    expect(strategyBody.status).toBe("grant_pending");

    const prepareResponse = await app.inject({
      method: "POST",
      url: "/grants/prepare",
      payload: {
        userId: registerBody.userId,
        strategyId: strategyBody.strategyId
      }
    });

    expect(prepareResponse.statusCode).toBe(200);

    const prepareBody = prepareResponse.json<{
      keeperAddress: string;
      grants: {
        move: { "@type": string };
        staking: { "@type": string } | null;
        feegrant: { "@type": string };
      };
    }>();

    expect(prepareBody.keeperAddress).toBe("init1replacekeeperaddress");
    expect(prepareBody.grants.move["@type"]).toBe("/cosmos.authz.v1beta1.MsgGrant");
    expect(prepareBody.grants.staking).toBeNull();
    expect(prepareBody.grants.feegrant["@type"]).toBe("/cosmos.feegrant.v1beta1.MsgGrantAllowance");

    const confirmResponse = await app.inject({
      method: "POST",
      url: "/grants/confirm",
      payload: {
        userId: registerBody.userId,
        strategyId: strategyBody.strategyId
      }
    });

    expect(confirmResponse.statusCode).toBe(200);

    const confirmBody = confirmResponse.json<{
      strategyId: string;
      strategyStatus: string;
      grantStatus: {
        move: string;
        staking: string;
        feegrant: string;
      };
    }>();

    expect(confirmBody.strategyStatus).toBe("active");
    expect(confirmBody.grantStatus).toEqual({
      move: "active",
      staking: "not-required",
      feegrant: "active"
    });

    const statusResponse = await app.inject({
      method: "GET",
      url: `/strategies/${strategyBody.strategyId}`
    });

    expect(statusResponse.statusCode).toBe(200);

    const statusBody = statusResponse.json<{
      strategyId: string;
      status: string;
      executionMode: string;
      grantStatus: {
        move: string;
        staking: string;
        feegrant: string;
        expiresAt: string | null;
      };
      balances: {
        input: string;
        lp: string;
        delegatedLp: string;
      };
      lastExecution: null;
    }>();

    expect(statusBody.strategyId).toBe(strategyBody.strategyId);
    expect(statusBody.status).toBe("active");
    expect(statusBody.executionMode).toBe("single-asset-provide-delegate");
    expect(statusBody.grantStatus).toEqual({
      move: "active",
      staking: "not-required",
      feegrant: "active",
      expiresAt: expect.any(String)
    });
    expect(statusBody.balances).toEqual({
      input: "0",
      lp: "0",
      delegatedLp: "0",
      delegatedLpKind: "bonded-locked"
    });
    expect(statusBody.lastExecution).toBeNull();

    const positionsResponse = await app.inject({
      method: "GET",
      url: `/positions/${registerBody.userId}`
    });

    expect(positionsResponse.statusCode).toBe(200);
    expect(positionsResponse.json()).toEqual({ positions: [] });

    const executionsResponse = await app.inject({
      method: "GET",
      url: `/strategies/${strategyBody.strategyId}/executions`
    });

    expect(executionsResponse.statusCode).toBe(200);
    expect(executionsResponse.json()).toEqual({ executions: [] });
  });

  it("prepares a lock-staking move grant when reward mode is enabled", async () => {
    const rewardApp = await createApp({
      config: {
        lockStakingModuleAddress:
          "0x81c3ea419d2fd3a27971021d9dd3cc708def05e5d6a09d39b2f1f9ba18312264",
        lockStakingModuleName: "lock_staking",
        lockupSeconds: "86400"
      }
    });

    try {
      await rewardApp.ready();
      await rewardApp.db.execute(`
        truncate table executions, positions, grants, strategies, users
        restart identity cascade;
      `);

      const registerResponse = await rewardApp.inject({
        method: "POST",
        url: "/users/register",
        payload: {
          initiaAddress: "init1rewarduseraddress"
        }
      });
      const registerBody = registerResponse.json<{
        userId: string;
      }>();

      const strategyResponse = await rewardApp.inject({
        method: "POST",
        url: "/strategies",
        payload: {
          userId: registerBody.userId,
          inputDenom: "usdc",
          targetPoolId: "pool-1",
          validatorAddress: "initvaloper1validator",
          minBalanceAmount: "100",
          maxAmountPerRun: "1000",
          maxSlippageBps: 100,
          cooldownSeconds: 300
        }
      });
      const strategyBody = strategyResponse.json<{
        strategyId: string;
      }>();

      const prepareResponse = await rewardApp.inject({
        method: "POST",
        url: "/grants/prepare",
        payload: {
          userId: registerBody.userId,
          strategyId: strategyBody.strategyId
        }
      });

      expect(prepareResponse.statusCode).toBe(200);

      const prepareBody = prepareResponse.json<{
        grants: {
          move: {
            grant: {
              authorization: {
                items: Array<{
                  module_address: string;
                  module_name: string;
                  function_names: string[];
                }>;
              };
            };
          };
          staking: null;
        };
      }>();

      expect(prepareBody.grants.move.grant.authorization.items).toEqual([
        {
          module_address:
            "0x81c3ea419d2fd3a27971021d9dd3cc708def05e5d6a09d39b2f1f9ba18312264",
          module_name: "lock_staking",
          function_names: ["single_asset_provide_delegate"]
        }
      ]);
      expect(prepareBody.grants.staking).toBeNull();

      const confirmResponse = await rewardApp.inject({
        method: "POST",
        url: "/grants/confirm",
        payload: {
          userId: registerBody.userId,
          strategyId: strategyBody.strategyId
        }
      });

      expect(confirmResponse.statusCode).toBe(200);
      expect(
        confirmResponse.json<{
          grantStatus: {
            move: string;
            staking: string;
            feegrant: string;
          };
        }>().grantStatus
      ).toEqual({
        move: "active",
        staking: "not-required",
        feegrant: "active"
      });

      const statusResponse = await rewardApp.inject({
        method: "GET",
        url: `/strategies/${strategyBody.strategyId}`
      });

      expect(statusResponse.statusCode).toBe(200);
      expect(
        statusResponse.json<{
          grantStatus: {
            move: string;
            staking: string;
            feegrant: string;
          };
        }>().grantStatus
      ).toEqual({
        move: "active",
        staking: "not-required",
        feegrant: "active",
        expiresAt: expect.any(String)
      });
    } finally {
      await rewardApp.close();
    }
  });

  it("labels bonded lock-staking balances explicitly in reward mode status and positions", async () => {
    const rewardApp = await createApp({
      config: {
        lockStakingModuleAddress:
          "0x81c3ea419d2fd3a27971021d9dd3cc708def05e5d6a09d39b2f1f9ba18312264",
        lockStakingModuleName: "lock_staking",
        lockupSeconds: "86400"
      }
    });

    try {
      await rewardApp.ready();
      await rewardApp.db.execute(`
        truncate table executions, positions, grants, strategies, users
        restart identity cascade;
      `);

      const registerResponse = await rewardApp.inject({
        method: "POST",
        url: "/users/register",
        payload: {
          initiaAddress: "init18f735agmd8zav9lrtnregkqn7eu4wc8cnanpql"
        }
      });
      const registerBody = registerResponse.json<{ userId: string }>();

      const strategyResponse = await rewardApp.inject({
        method: "POST",
        url: "/strategies",
        payload: {
          userId: registerBody.userId,
          inputDenom: "usdc",
          targetPoolId:
            "0xdbf06c48af3984ec6d9ae8a9aa7dbb0bb1e784aa9b8c4a5681af660cf8558d7d",
          validatorAddress: "initvaloper1cduny8wdjupu2lhya9npc9j4x5ytn05kt36x0c",
          minBalanceAmount: "100",
          maxAmountPerRun: "1000",
          maxSlippageBps: 100,
          cooldownSeconds: 300
        }
      });
      const strategyBody = strategyResponse.json<{ strategyId: string }>();

      await rewardApp.db.insert(positions).values({
        strategyId: strategyBody.strategyId,
        userId: registerBody.userId,
        lastInputBalance: "500",
        lastLpBalance: "0",
        lastDelegatedLpBalance: "828440",
        lastRewardSnapshot: JSON.stringify({
          kind: "bonded-locked",
          stakingAccount:
            "0x3ae0ed3bacfcd47f69ff2e8bf968adadb2a5fdaa51c8c7809e026fbe2efc4ca",
          metadata:
            "0xdbf06c48af3984ec6d9ae8a9aa7dbb0bb1e784aa9b8c4a5681af660cf8558d7d",
          releaseTime: "1777057735",
          releaseTimeIso: "2026-04-24T19:08:55.000Z",
          validatorAddress: "initvaloper1cduny8wdjupu2lhya9npc9j4x5ytn05kt36x0c",
          lockedShare: "828440"
        }),
        lastSyncedAt: new Date("2026-04-23T19:08:55.000Z")
      });

      const statusResponse = await rewardApp.inject({
        method: "GET",
        url: `/strategies/${strategyBody.strategyId}`
      });

      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toMatchObject({
        strategyId: strategyBody.strategyId,
        executionMode: "single-asset-provide-delegate",
        balances: {
          input: "500",
          lp: "0",
          delegatedLp: "828440",
          delegatedLpKind: "bonded-locked"
        },
        rewardLock: {
          releaseTime: "1777057735",
          releaseTimeIso: "2026-04-24T19:08:55.000Z",
          stakingAccount:
            "0x3ae0ed3bacfcd47f69ff2e8bf968adadb2a5fdaa51c8c7809e026fbe2efc4ca"
        }
      });

      const positionsResponse = await rewardApp.inject({
        method: "GET",
        url: `/positions/${registerBody.userId}`
      });

      expect(positionsResponse.statusCode).toBe(200);
      expect(positionsResponse.json()).toMatchObject({
        positions: [
          {
            strategyId: strategyBody.strategyId,
            inputDenom: "usdc",
            targetPoolId:
              "0xdbf06c48af3984ec6d9ae8a9aa7dbb0bb1e784aa9b8c4a5681af660cf8558d7d",
            validatorAddress: "initvaloper1cduny8wdjupu2lhya9npc9j4x5ytn05kt36x0c",
            executionMode: "single-asset-provide-delegate",
            delegatedLpKind: "bonded-locked",
            lastDelegatedLpBalance: "828440",
            rewardLock: {
              releaseTime: "1777057735",
              releaseTimeIso: "2026-04-24T19:08:55.000Z",
              stakingAccount:
                "0x3ae0ed3bacfcd47f69ff2e8bf968adadb2a5fdaa51c8c7809e026fbe2efc4ca"
            }
          }
        ]
      });
    } finally {
      await rewardApp.close();
    }
  });
});
