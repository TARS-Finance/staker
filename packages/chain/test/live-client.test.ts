import { bcs } from "@initia/initia.js";
import { describe, expect, it, vi } from "vitest";
import { createLiveKeeperChainClient } from "../src/index.js";

const pairObjectId = `0x${"1".repeat(64)}`;
const coinMetadataObjectId = `0x${"2".repeat(64)}`;

describe("live keeper chain client", () => {
  it("reads input, lp, and delegated balances from Initia REST queries", async () => {
    const balanceByDenom = vi.fn(async (_address: string, denom: string) => {
      if (denom === "usdc") {
        return { amount: "500", denom };
      }

      if (denom === "ulp") {
        return { amount: "25", denom };
      }

      return undefined;
    });

    const client = createLiveKeeperChainClient({
      lcdUrl: "https://rest.testnet.initia.xyz",
      privateKey: "1".repeat(64),
      keeperAddress: "init1keeperaddress",
      restClient: {
        bank: { balanceByDenom },
        move: {
          metadata: vi.fn(async () => coinMetadataObjectId)
        },
        mstaking: {
          delegation: vi.fn(async () => ({
            balance: {
              get: (denom: string) =>
                denom === "ulp" ? { amount: "18", denom } : undefined
            }
          }))
        },
        tx: {
          simulate: vi.fn(),
          broadcast: vi.fn(),
          txInfo: vi.fn()
        }
      },
      wallet: {
        accAddress: "init1keeperaddress",
        createAndSignTx: vi.fn(),
        sequence: vi.fn(async () => 7)
      }
    });

    await expect(
      client.getInputBalance({
        userAddress: "init1useraddress",
        denom: "usdc"
      })
    ).resolves.toBe("500");
    await expect(
      client.getLpBalance({
        userAddress: "init1useraddress",
        lpDenom: "ulp"
      })
    ).resolves.toBe("25");
    await expect(
      client.getDelegatedLpBalance({
        userAddress: "init1useraddress",
        validatorAddress: "initvaloper1validator",
        lpDenom: "ulp"
      })
    ).resolves.toBe("18");
  });

  it("signs and broadcasts an authz-wrapped provide tx and returns the lp delta", async () => {
    const balanceByDenom = vi
      .fn()
      .mockResolvedValueOnce({ amount: "10", denom: "ulp" })
      .mockResolvedValueOnce({ amount: "25", denom: "ulp" });
    const broadcast = vi.fn(async () => ({
      txhash: "provide-hash",
      raw_log: "",
      logs: []
    }));
    const simulate = vi.fn(async () => ({
      result: {
        events: [
          {
            type: "move",
            attributes: [
              { key: "type_tag", value: "0x1::dex::ProvideEvent" },
              { key: "liquidity_token", value: pairObjectId },
              { key: "liquidity", value: "20" }
            ]
          }
        ]
      }
    }));
    const createAndSignTx = vi.fn(async (input: unknown) => input);

    const client = createLiveKeeperChainClient({
      lcdUrl: "https://rest.testnet.initia.xyz",
      privateKey: "1".repeat(64),
      keeperAddress: "init1keeperaddress",
      restClient: {
        bank: { balanceByDenom },
        move: {
          metadata: vi.fn(async () => coinMetadataObjectId)
        },
        mstaking: {
          delegation: vi.fn()
        },
        tx: {
          simulate,
          broadcast,
          txInfo: vi.fn()
        }
      },
      wallet: {
        accAddress: "init1keeperaddress",
        createAndSignTx,
        sequence: vi.fn(async () => 7)
      }
    });

    await expect(
      client.provideSingleAssetLiquidity({
        userAddress: "init1useraddress",
        targetPoolId: pairObjectId,
        inputDenom: "usdc",
        lpDenom: "ulp",
        amount: "250",
        maxSlippageBps: "100",
        moduleAddress: "0x1",
        moduleName: "dex"
      })
    ).resolves.toEqual({
      txHash: "provide-hash",
      lpAmount: "15"
    });

    const provideTxInput = createAndSignTx.mock.calls[0]?.[0] as {
      msgs: Array<{
        toData(): {
          "@type": string;
          msgs: Array<{ args: string[] }>;
        };
      }>;
    };

    expect(createAndSignTx).toHaveBeenCalledTimes(1);
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(provideTxInput.msgs[0]?.toData()["@type"]).toBe(
      "/cosmos.authz.v1beta1.MsgExec"
    );
    expect(
      provideTxInput.msgs[0]?.toData().msgs[0]?.args[3]
    ).toBe(bcs.option(bcs.u64()).serialize(19n).toBase64());
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("signs and broadcasts an authz-wrapped single-asset provide+delegate tx", async () => {
    const delegatedBalances = vi
      .fn()
      .mockResolvedValueOnce({
        balance: {
          get: (denom: string) =>
            denom === "ulp" ? { amount: "10", denom } : undefined
        }
      })
      .mockResolvedValueOnce({
        balance: {
          get: (denom: string) =>
            denom === "ulp" ? { amount: "25", denom } : undefined
        }
      });
    const broadcast = vi.fn(async () => ({
      txhash: "provide-delegate-hash",
      raw_log: "",
      logs: []
    }));
    const simulate = vi.fn(async () => ({
      result: {
        events: [
          {
            type: "move",
            attributes: [
              { key: "type_tag", value: "0x1::dex::ProvideEvent" },
              { key: "liquidity_token", value: pairObjectId },
              { key: "liquidity", value: "20" }
            ]
          }
        ]
      }
    }));
    const createAndSignTx = vi.fn(async (input: unknown) => input);

    const client = createLiveKeeperChainClient({
      lcdUrl: "https://rest.testnet.initia.xyz",
      privateKey: "1".repeat(64),
      keeperAddress: "init1keeperaddress",
      restClient: {
        bank: {
          balanceByDenom: vi.fn(async () => ({ amount: "0", denom: "ulp" }))
        },
        move: {
          metadata: vi.fn(async () => coinMetadataObjectId)
        },
        mstaking: {
          delegation: delegatedBalances
        },
        tx: {
          simulate,
          broadcast,
          txInfo: vi.fn()
        }
      },
      wallet: {
        accAddress: "init1keeperaddress",
        createAndSignTx,
        sequence: vi.fn(async () => 7)
      }
    });

    await expect(
      client.singleAssetProvideDelegate({
        userAddress: "init1useraddress",
        targetPoolId: pairObjectId,
        inputDenom: "usdc",
        lpDenom: "ulp",
        amount: "250",
        maxSlippageBps: "100",
        moduleAddress: "0xlock",
        moduleName: "lock_staking",
        releaseTime: "1776970386",
        validatorAddress: "initvaloper1validator"
      })
    ).resolves.toEqual({
      txHash: "provide-delegate-hash",
      lpAmount: "15"
    });

    const provideDelegateTxInput = createAndSignTx.mock.calls[0]?.[0] as {
      msgs: Array<{
        toData(): {
          "@type": string;
          msgs: Array<{ args: string[] }>;
        };
      }>;
    };

    expect(simulate).toHaveBeenCalledTimes(1);
    expect(provideDelegateTxInput.msgs[0]?.toData()["@type"]).toBe(
      "/cosmos.authz.v1beta1.MsgExec"
    );
    expect(
      provideDelegateTxInput.msgs[0]?.toData().msgs[0]?.args[4]
    ).toBe(bcs.u64().serialize(1776970386n).toBase64());
    expect(
      provideDelegateTxInput.msgs[0]?.toData().msgs[0]?.args[5]
    ).toBe(bcs.string().serialize("initvaloper1validator").toBase64());
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("refuses to broadcast a provide tx when simulation cannot derive an lp quote", async () => {
    const broadcast = vi.fn(async () => ({
      txhash: "provide-hash",
      raw_log: "",
      logs: []
    }));
    const simulate = vi.fn(async () => ({
      result: {
        events: [
          {
            type: "move",
            attributes: [
              { key: "type_tag", value: "0x1::dex::ProvideEvent" },
              { key: "liquidity_token", value: `0x${"3".repeat(64)}` },
              { key: "liquidity", value: "20" }
            ]
          }
        ]
      }
    }));

    const client = createLiveKeeperChainClient({
      lcdUrl: "https://rest.testnet.initia.xyz",
      privateKey: "1".repeat(64),
      keeperAddress: "init1keeperaddress",
      restClient: {
        bank: {
          balanceByDenom: vi.fn(async () => ({ amount: "10", denom: "ulp" }))
        },
        move: {
          metadata: vi.fn(async () => coinMetadataObjectId)
        },
        mstaking: {
          delegation: vi.fn()
        },
        tx: {
          simulate,
          broadcast,
          txInfo: vi.fn()
        }
      },
      wallet: {
        accAddress: "init1keeperaddress",
        createAndSignTx: vi.fn(async (input: unknown) => input),
        sequence: vi.fn(async () => 7)
      }
    });

    await expect(
      client.provideSingleAssetLiquidity({
        userAddress: "init1useraddress",
        targetPoolId: pairObjectId,
        inputDenom: "usdc",
        lpDenom: "ulp",
        amount: "250",
        maxSlippageBps: "100",
        moduleAddress: "0x1",
        moduleName: "dex"
      })
    ).rejects.toThrow(/lp quote/i);

    expect(simulate).toHaveBeenCalledTimes(1);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("signs and broadcasts an authz-wrapped delegate tx", async () => {
    const broadcast = vi.fn(async () => ({
      txhash: "delegate-hash",
      raw_log: "",
      logs: []
    }));
    const createAndSignTx = vi.fn(async (input: unknown) => input);

    const client = createLiveKeeperChainClient({
      lcdUrl: "https://rest.testnet.initia.xyz",
      privateKey: "1".repeat(64),
      keeperAddress: "init1keeperaddress",
      restClient: {
        bank: {
          balanceByDenom: vi.fn()
        },
        move: {
          metadata: vi.fn(async () => coinMetadataObjectId)
        },
        mstaking: {
          delegation: vi.fn()
        },
        tx: {
          simulate: vi.fn(),
          broadcast,
          txInfo: vi.fn()
        }
      },
      wallet: {
        accAddress: "init1keeperaddress",
        createAndSignTx,
        sequence: vi.fn(async () => 7)
      }
    });

    await expect(
      client.delegateLp({
        userAddress: "init1useraddress",
        validatorAddress: "initvaloper1validator",
        lpDenom: "ulp",
        amount: "15"
      })
    ).resolves.toEqual({
      txHash: "delegate-hash"
    });

    const delegateTxInput = createAndSignTx.mock.calls[0]?.[0] as {
      msgs: Array<{ toData(): { "@type": string } }>;
    };

    expect(delegateTxInput.msgs[0]?.toData()["@type"]).toBe(
      "/cosmos.authz.v1beta1.MsgExec"
    );
  });

  it("fails fast when the derived wallet address does not match the configured keeper", () => {
    expect(() =>
      createLiveKeeperChainClient({
        lcdUrl: "https://rest.testnet.initia.xyz",
        privateKey: "1".repeat(64),
        keeperAddress: "init1configuredkeeper",
        restClient: {
          bank: {
            balanceByDenom: vi.fn()
          },
          move: {
            metadata: vi.fn(async () => coinMetadataObjectId)
          },
          mstaking: {
            delegation: vi.fn()
          },
          tx: {
            simulate: vi.fn(),
            broadcast: vi.fn(),
            txInfo: vi.fn()
          }
        },
        wallet: {
          accAddress: "init1differentkeeper",
          createAndSignTx: vi.fn(),
          sequence: vi.fn()
        }
      })
    ).toThrow(/keeper address/i);
  });
});
