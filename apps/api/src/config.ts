import { config as loadDotEnv } from "dotenv";
import { loadEnvironment } from "@stacker/shared";

export type ApiConfig = {
  port: number;
  databaseUrl: string;
  keeperAddress: string;
  executionMode: "provide-then-delegate" | "single-asset-provide-delegate";
  dexModuleAddress: string;
  dexModuleName: string;
  lockStakingModuleAddress?: string;
  lockStakingModuleName?: string;
  lockupSeconds?: string;
  feeDenom: string;
  lpDenom: string;
  grantExpiryHours: number;
};

export function loadApiConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  loadDotEnv({ quiet: true });

  const env = loadEnvironment();

  return {
    port: Number(process.env.API_PORT ?? "3000"),
    databaseUrl: env.databaseUrl,
    keeperAddress: env.keeperAddress,
    executionMode: env.strategyExecutionMode ?? "provide-then-delegate",
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
