import { config as loadDotEnv } from "dotenv";
import { loadEnvironment } from "@stacker/shared";

export type ApiConfig = {
  port: number;
  databaseUrl: string;
  initiaLcdUrl: string;
  keeperAddress: string;
  dexModuleAddress: string;
  dexModuleName: string;
  lockStakingModuleAddress: string;
  lockStakingModuleName: string;
  lockupSeconds: string;
  feeDenom: string;
  lpDenom: string;
  grantExpiryHours: number;
};

export function loadApiConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  loadDotEnv({ quiet: true });

  const env = loadEnvironment({
    ...process.env,
    DATABASE_URL: overrides.databaseUrl ?? process.env.DATABASE_URL,
    KEEPER_ADDRESS: overrides.keeperAddress ?? process.env.KEEPER_ADDRESS,
    DEX_MODULE_ADDRESS:
      overrides.dexModuleAddress ?? process.env.DEX_MODULE_ADDRESS,
    DEX_MODULE_NAME: overrides.dexModuleName ?? process.env.DEX_MODULE_NAME,
    LOCK_STAKING_MODULE_ADDRESS:
      overrides.lockStakingModuleAddress
      ?? process.env.LOCK_STAKING_MODULE_ADDRESS,
    LOCK_STAKING_MODULE_NAME:
      overrides.lockStakingModuleName
      ?? process.env.LOCK_STAKING_MODULE_NAME,
    LOCKUP_SECONDS: overrides.lockupSeconds ?? process.env.LOCKUP_SECONDS
  });

  return {
    port: Number(process.env.API_PORT ?? "3000"),
    databaseUrl: env.databaseUrl,
    initiaLcdUrl: env.initiaLcdUrl,
    keeperAddress: env.keeperAddress,
    dexModuleAddress: env.dexModuleAddress,
    dexModuleName: env.dexModuleName,
    lockStakingModuleAddress: env.lockStakingModuleAddress,
    lockStakingModuleName: env.lockStakingModuleName ?? "lock_staking",
    lockupSeconds: env.lockupSeconds,
    feeDenom: process.env.FEE_DENOM ?? "uinit",
    lpDenom: process.env.LP_DENOM ?? "ulp",
    grantExpiryHours: Number(process.env.GRANT_EXPIRY_HOURS ?? "720"),
    ...overrides
  };
}
