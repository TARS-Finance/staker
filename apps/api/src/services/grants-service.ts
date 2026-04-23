import { buildFeeGrant, buildMoveGrant, buildStakeGrant } from "@stacker/chain";
import { GrantsRepository, StrategiesRepository, UsersRepository } from "@stacker/db";
import type { ApiConfig } from "../config.js";

export class GrantsService {
  constructor(
    private readonly grantsRepository: GrantsRepository,
    private readonly strategiesRepository: StrategiesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly config: ApiConfig
  ) {}

  async prepare(userId: string, strategyId: string) {
    const strategy = await this.strategiesRepository.findById(strategyId);
    const user = await this.usersRepository.findById(userId);

    if (!strategy || strategy.userId !== userId || !user) {
      return null;
    }

    const expiresAt = new Date(
      Date.now() + this.config.grantExpiryHours * 60 * 60 * 1000
    );
    const moveGrant = buildMoveGrant({
      granter: user.initiaAddress,
      grantee: this.config.keeperAddress,
      moduleAddress: this.config.dexModuleAddress,
      moduleName: this.config.dexModuleName,
      functionNames: ["single_asset_provide_liquidity_script"],
      expiresAt
    });
    const stakingGrant = buildStakeGrant({
      granter: user.initiaAddress,
      grantee: this.config.keeperAddress,
      validatorAddress: strategy.validatorAddress,
      maxTokens: {
        denom: this.config.lpDenom,
        amount: strategy.maxAmountPerRun
      },
      expiresAt
    });
    const feeGrant = buildFeeGrant({
      granter: user.initiaAddress,
      grantee: this.config.keeperAddress,
      spendLimit: {
        denom: this.config.feeDenom,
        amount: "2500"
      },
      expiresAt
    });

    await this.grantsRepository.upsertForUser({
      userId,
      keeperAddress: this.config.keeperAddress,
      moveGrantExpiresAt: expiresAt,
      stakingGrantExpiresAt: expiresAt,
      feegrantExpiresAt: expiresAt,
      moveGrantStatus: "pending",
      stakingGrantStatus: "pending",
      feegrantStatus: "pending",
      scopeJson: {
        moveGrant: moveGrant.toData(),
        stakingGrant: stakingGrant.toData(),
        feeGrant: feeGrant.toData()
      }
    });

    return {
      keeperAddress: this.config.keeperAddress,
      grants: {
        move: moveGrant.toData(),
        staking: stakingGrant.toData(),
        feegrant: feeGrant.toData()
      }
    };
  }

  async confirm(userId: string, strategyId: string) {
    const strategy = await this.strategiesRepository.findById(strategyId);
    const existingGrant = await this.grantsRepository.findByUserId(userId);

    if (!strategy || strategy.userId !== userId || !existingGrant) {
      return null;
    }

    await this.grantsRepository.upsertForUser({
      userId,
      keeperAddress: existingGrant.keeperAddress,
      moveGrantExpiresAt: existingGrant.moveGrantExpiresAt,
      stakingGrantExpiresAt: existingGrant.stakingGrantExpiresAt,
      feegrantExpiresAt: existingGrant.feegrantExpiresAt,
      moveGrantStatus: "active",
      stakingGrantStatus: "active",
      feegrantStatus: "active",
      scopeJson: existingGrant.scopeJson
    });

    const updatedStrategy = await this.strategiesRepository.updateStatus(
      strategyId,
      "active"
    );

    return {
      strategyId,
      strategyStatus: updatedStrategy?.status ?? "active",
      grantStatus: {
        move: "active",
        staking: "active",
        feegrant: "active"
      }
    };
  }
}
