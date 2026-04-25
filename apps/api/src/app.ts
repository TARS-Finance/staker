import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { RESTClient } from "@initia/initia.js";
import {
  ExecutionsRepository,
  GrantsRepository,
  openDatabase,
  PositionsRepository,
  StrategiesRepository,
  UsersRepository,
  type StackerDatabase
} from "@stacker/db";
import type { ApiConfig } from "./config.js";
import { loadApiConfig } from "./config.js";
import { executionsRoutes } from "./routes/executions.js";
import { grantsRoutes } from "./routes/grants.js";
import { merchantsRoutes } from "./routes/merchants.js";
import { positionsRoutes } from "./routes/positions.js";
import { strategiesRoutes } from "./routes/strategies.js";
import { usersRoutes } from "./routes/users.js";
import { ExecutionsService } from "./services/executions-service.js";
import {
  type GrantVerifier,
  InitiaGrantVerifier
} from "./services/grant-verifier.js";
import { GrantsService } from "./services/grants-service.js";
import { PositionsService } from "./services/positions-service.js";
import { StrategiesService } from "./services/strategies-service.js";
import { UsersService } from "./services/users-service.js";

export type AppServices = {
  users: UsersService;
  strategies: StrategiesService;
  grants: GrantsService;
  positions: PositionsService;
  executions: ExecutionsService;
};

declare module "fastify" {
  interface FastifyInstance {
    db: StackerDatabase;
    services: AppServices;
    stackerConfig: ApiConfig;
  }
}

function createServices(
  db: StackerDatabase,
  config: ApiConfig,
  grantVerifier: GrantVerifier
): AppServices {
  const usersRepository = new UsersRepository(db);
  const strategiesRepository = new StrategiesRepository(db);
  const grantsRepository = new GrantsRepository(db);
  const positionsRepository = new PositionsRepository(db);
  const executionsRepository = new ExecutionsRepository(db);

  return {
    users: new UsersService(usersRepository),
    strategies: new StrategiesService(
      strategiesRepository,
      grantsRepository,
      positionsRepository,
      executionsRepository,
      config
    ),
    grants: new GrantsService(
      grantsRepository,
      strategiesRepository,
      usersRepository,
      config,
      grantVerifier
    ),
    positions: new PositionsService(
      positionsRepository,
      strategiesRepository,
      executionsRepository
    ),
    executions: new ExecutionsService(executionsRepository)
  };
}

export async function createApp(
  options: {
    config?: Partial<ApiConfig>;
    grantVerifier?: GrantVerifier;
    logger?: boolean;
  } = {}
): Promise<FastifyInstance> {
  const config = loadApiConfig(options.config);
  const { client, db } = openDatabase(config.databaseUrl);

  await client.connect();

  const app = Fastify({
    logger: options.logger ?? false
  });

  await app.register(cors, { origin: true });

  const grantVerifier =
    options.grantVerifier
    ?? new InitiaGrantVerifier(new RESTClient(config.initiaLcdUrl));

  app.decorate("db", db);
  app.decorate("services", createServices(db, config, grantVerifier));
  app.decorate("stackerConfig", config);

  app.addHook("onClose", async () => {
    await client.end();
  });

  await app.register(usersRoutes);
  await app.register(strategiesRoutes);
  await app.register(grantsRoutes);
  await app.register(positionsRoutes);
  await app.register(merchantsRoutes);
  await app.register(executionsRoutes);

  return app;
}
