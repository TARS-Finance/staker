import {
  ExecutionsRepository,
  GrantsRepository,
  openDatabase,
  PositionsRepository,
  StrategiesRepository,
  UsersRepository
} from "@stacker/db";
import type { KeeperChainClient } from "@stacker/chain";
import { loadKeeperConfig } from "./config.js";
import { runTickJob } from "./jobs/run-tick.js";
import { createKeeperRunner } from "./runner/keeper-runner.js";
import { StrategyLocks } from "./runner/locks.js";

function createUnimplementedChainClient(): KeeperChainClient {
  const message =
    "Live keeper chain client is not implemented yet. Phase 5 will add dry-run and live clients.";

  return {
    async getInputBalance() {
      throw new Error(message);
    },
    async getLpBalance() {
      throw new Error(message);
    },
    async getDelegatedLpBalance() {
      throw new Error(message);
    },
    async provideSingleAssetLiquidity() {
      throw new Error(message);
    },
    async delegateLp() {
      throw new Error(message);
    },
    async isTxConfirmed() {
      throw new Error(message);
    }
  };
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
  chain: createUnimplementedChainClient(),
  locks: new StrategyLocks(),
  lpDenom: config.lpDenom
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
