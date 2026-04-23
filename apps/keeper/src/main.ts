import {
  ExecutionsRepository,
  GrantsRepository,
  openDatabase,
  PositionsRepository,
  StrategiesRepository,
  UsersRepository
} from "@stacker/db";
import {
  createDryRunKeeperChainClient,
  createLiveKeeperChainClient,
  type KeeperChainClient
} from "@stacker/chain";
import { loadKeeperConfig } from "./config.js";
import { runTickJob } from "./jobs/run-tick.js";
import { createKeeperRunner } from "./runner/keeper-runner.js";
import { StrategyLocks } from "./runner/locks.js";

function createChainClient(config: ReturnType<typeof loadKeeperConfig>): KeeperChainClient {
  if (config.mode === "dry-run") {
    return createDryRunKeeperChainClient({
      keeperAddress: config.keeperAddress,
      lpDenom: config.lpDenom,
      defaultInputBalance: config.dryRunInputBalance
    });
  }

  return createLiveKeeperChainClient({
    lcdUrl: config.initiaLcdUrl,
    privateKey: config.keeperPrivateKey,
    keeperAddress: config.keeperAddress,
    gasPrices: config.gasPrices,
    gasAdjustment: config.gasAdjustment
  });
}

const config = loadKeeperConfig();
const { client, db } = openDatabase(config.databaseUrl);

await client.connect();

const runner = createKeeperRunner({
  now: () => new Date(),
  usersRepository: new UsersRepository(db),
  strategiesRepository: new StrategiesRepository(db),
  grantsRepository: new GrantsRepository(db),
  executionsRepository: new ExecutionsRepository(db),
  positionsRepository: new PositionsRepository(db),
  chain: createChainClient(config),
  locks: new StrategyLocks(),
  lpDenom: config.lpDenom,
  lockStakingModuleAddress: config.lockStakingModuleAddress,
  lockStakingModuleName: config.lockStakingModuleName,
  lockupSeconds: config.lockupSeconds
});

const timer = setInterval(async () => {
  try {
    await runTickJob(runner);
  } catch (error) {
    console.error("keeper tick failed", error);
  }
}, config.pollIntervalMs);

const shutdown = async () => {
  clearInterval(timer);
  await client.end();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
