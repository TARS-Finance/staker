export type KeeperMode = "dry-run" | "live";

export type ProvideSingleAssetLiquidityRequest = {
  userAddress: string;
  targetPoolId: string;
  inputDenom: string;
  amount: string;
  maxSlippageBps: string;
  moduleAddress: string;
  moduleName: string;
};

export type ProvideSingleAssetLiquidityResult = {
  txHash: string;
  lpAmount: string;
};

export type DelegateLpRequest = {
  userAddress: string;
  validatorAddress: string;
  lpDenom: string;
  amount: string;
};

export type DelegateLpResult = {
  txHash: string;
};

export interface KeeperChainClient {
  readonly mode: KeeperMode;
  getInputBalance(input: {
    userAddress: string;
    denom: string;
  }): Promise<string>;
  getLpBalance(input: {
    userAddress: string;
    lpDenom: string;
  }): Promise<string>;
  getDelegatedLpBalance(input: {
    userAddress: string;
    validatorAddress: string;
    lpDenom: string;
  }): Promise<string>;
  provideSingleAssetLiquidity(
    input: ProvideSingleAssetLiquidityRequest
  ): Promise<ProvideSingleAssetLiquidityResult>;
  delegateLp(input: DelegateLpRequest): Promise<DelegateLpResult>;
  isTxConfirmed(txHash: string): Promise<boolean>;
}
