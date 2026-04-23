export type StackerEnvironment = {
  databaseUrl: string;
  keeperPrivateKey: string;
  initiaLcdUrl: string;
  initiaRpcUrl: string;
  keeperAddress: string;
  targetPoolId: string;
  dexModuleAddress: string;
  dexModuleName: string;
  strategyExecutionMode?: "provide-then-delegate" | "single-asset-provide-delegate";
  lockStakingModuleAddress?: string;
  lockStakingModuleName?: string;
  lockupSeconds?: string;
};
