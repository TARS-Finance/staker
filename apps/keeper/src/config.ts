import { config as loadDotEnv } from "dotenv";
import { loadEnvironment } from "@stacker/shared";

export type KeeperConfig = {
  databaseUrl: string;
  keeperAddress: string;
  dexModuleAddress: string;
  dexModuleName: string;
  lpDenom: string;
  mode: "dry-run" | "live";
  dryRunInputBalance: string;
  pollIntervalMs: number;
};

export function loadKeeperConfig(
  overrides: Partial<KeeperConfig> = {}
): KeeperConfig {
  loadDotEnv({ quiet: true });

  const environment = loadEnvironment();

  return {
    databaseUrl: environment.databaseUrl,
    keeperAddress: environment.keeperAddress,
    dexModuleAddress: environment.dexModuleAddress,
    dexModuleName: environment.dexModuleName,
    lpDenom: process.env.LP_DENOM ?? "ulp",
    mode: process.env.KEEPER_MODE === "live" ? "live" : "dry-run",
    dryRunInputBalance: process.env.KEEPER_DRY_RUN_INPUT_BALANCE ?? "0",
    pollIntervalMs: Number(process.env.KEEPER_POLL_INTERVAL_MS ?? "60000"),
    ...overrides
  };
}
