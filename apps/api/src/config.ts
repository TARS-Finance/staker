import { config as loadDotEnv } from "dotenv";
import { loadEnvironment } from "@stacker/shared";

export type ApiConfig = {
  port: number;
  databaseUrl: string;
  keeperAddress: string;
  dexModuleAddress: string;
  dexModuleName: string;
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
    dexModuleAddress: env.dexModuleAddress,
    dexModuleName: env.dexModuleName,
    feeDenom: process.env.FEE_DENOM ?? "uinit",
    lpDenom: process.env.LP_DENOM ?? "ulp",
    grantExpiryHours: Number(process.env.GRANT_EXPIRY_HOURS ?? "720"),
    ...overrides
  };
}
