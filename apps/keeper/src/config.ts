import { config as loadDotEnv } from "dotenv";
import { loadEnvironment } from "@stacker/shared";

export type KeeperConfig = {
  databaseUrl: string;
  initiaLcdUrl: string;
  keeperPrivateKey: string;
  keeperAddress: string;
  executionMode: "provide-then-delegate" | "single-asset-provide-delegate";
  dexModuleAddress: string;
  dexModuleName: string;
  lockStakingModuleAddress?: string;
  lockStakingModuleName?: string;
  lockupSeconds?: string;
  lpDenom: string;
  mode: "dry-run" | "live";
  dryRunInputBalance: string;
  gasPrices?: string;
  gasAdjustment?: string;
  pollIntervalMs: number;
};

export function loadKeeperConfig(
  overrides: Partial<KeeperConfig> = {}
): KeeperConfig {
  loadDotEnv({ quiet: true });

  const environment = loadEnvironment();

  return {
    databaseUrl: environment.databaseUrl,
    initiaLcdUrl: environment.initiaLcdUrl,
    keeperPrivateKey: environment.keeperPrivateKey,
    keeperAddress: environment.keeperAddress,
    executionMode: environment.strategyExecutionMode ?? "provide-then-delegate",
    dexModuleAddress: environment.dexModuleAddress,
    dexModuleName: environment.dexModuleName,
    lockStakingModuleAddress: environment.lockStakingModuleAddress,
    lockStakingModuleName: environment.lockStakingModuleName ?? "lock_staking",
    lockupSeconds: environment.lockupSeconds,
    lpDenom: process.env.LP_DENOM ?? "ulp",
    mode: process.env.KEEPER_MODE === "live" ? "live" : "dry-run",
    dryRunInputBalance: process.env.KEEPER_DRY_RUN_INPUT_BALANCE ?? "0",
    gasPrices: process.env.INITIA_GAS_PRICES,
    gasAdjustment: process.env.INITIA_GAS_ADJUSTMENT,
    pollIntervalMs: Number(process.env.KEEPER_POLL_INTERVAL_MS ?? "60000"),
    ...overrides
  };
}
