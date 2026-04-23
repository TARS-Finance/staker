# Keeper Operations

## Purpose

This runbook covers local startup, dry-run execution, grant debugging, partial failure handling, and a safe rollout sequence for the `stacker` keeper.

## Local Startup

1. Ensure PostgreSQL is reachable on `DATABASE_URL`.
2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Apply migrations:

   ```bash
   pnpm db:migrate
   ```

4. Start the API:

   ```bash
   pnpm --filter @stacker/api dev
   ```

5. Start the keeper in dry-run mode:

   ```bash
   KEEPER_MODE=dry-run KEEPER_DRY_RUN_INPUT_BALANCE=1000 pnpm --filter @stacker/keeper dev
   ```

6. For a live testnet run, switch to live mode only after the dry-run path is clean:

   ```bash
   KEEPER_MODE=live pnpm --filter @stacker/keeper dev
   ```

## Dry-Run Execution

- `KEEPER_MODE=dry-run` swaps in the dry-run chain client.
- No live broadcasts occur. The dry-run client builds `MsgExec` payloads, updates in-memory balances, and writes `simulated` execution records.
- Use the mock frontend script to seed a strategy lifecycle quickly:

  ```bash
  pnpm exec tsx scripts/mock-fe.ts --api-base-url http://127.0.0.1:3000 --config ./scripts/mock-fe.example.json
  ```

## Direct Smoke Path

If you want to prove the chain entrypoint before relying on keeper authz, use:

```bash
SMOKE_PRIVATE_KEY=replace-me \
SMOKE_TARGET_POOL_ID=replace-pool-id \
SMOKE_INPUT_DENOM=uusdc \
SMOKE_AMOUNT=1000000 \
SMOKE_VALIDATOR_ADDRESS=initvaloper1... \
pnpm smoke:testnet:single-asset-provide-delegate
```

Set `SMOKE_CONFIRM_BROADCAST=true` to submit the tx after reviewing the preview
output.

## Live Execution

- `KEEPER_MODE=live` uses the real Initia `RESTClient` and signs with `KEEPER_PRIVATE_KEY`.
- Startup fails fast if the derived wallet address does not match `KEEPER_ADDRESS`.
- `STRATEGY_EXECUTION_MODE=provide-then-delegate` keeps the original two-step flow:
  1. `dex::single_asset_provide_liquidity_script`
  2. `mstaking::MsgDelegate`
- `STRATEGY_EXECUTION_MODE=single-asset-provide-delegate` switches to the direct reward-bearing flow:
  1. `vip::lock_staking::single_asset_provide_delegate`
  2. no follow-up delegate tx
- Both flows resolve the input coin metadata with `move.metadata(inputDenom)`, simulate the authz-wrapped call first, derive an LP quote from the simulated Move `0x1::dex::ProvideEvent`, and then BCS-encode `min_liquidity` from that quote before broadcast.
- In two-step mode, if the tx confirms but no LP delta is observable yet, the strategy moves to `partial_lp` and the next tick retries delegation only after reconciliation sees the LP tokens.
- If simulation does not produce a trustworthy LP quote for the configured pool, the keeper refuses to broadcast.

## Grant Debugging

Check grant preparation output first:

```bash
curl -s http://127.0.0.1:3000/grants/prepare \
  -H 'content-type: application/json' \
  -d '{"userId":"<uuid>","strategyId":"<uuid>"}'
```

Review:
- keeper address
- move grant module/function scope
- staking grant validator allowlist
- feegrant allowed messages

When `STRATEGY_EXECUTION_MODE=single-asset-provide-delegate`, the move grant should target:
- module address: `LOCK_STAKING_MODULE_ADDRESS`
- module name: `LOCK_STAKING_MODULE_NAME`
- function name: `single_asset_provide_delegate`

If `grants/confirm` succeeds but the keeper still skips the strategy, inspect:
- `moveGrantStatus`, `stakingGrantStatus`, `feegrantStatus`
- `moveGrantExpiresAt`, `stakingGrantExpiresAt`, `feegrantExpiresAt`
- strategy `status`

## Partial Failure Handling

The keeper currently distinguishes:

- `provide-failed`: liquidity step failed before an LP delta existed
- `missing-liquidity`: provide tx broadcasted, but LP mint was not observable yet, so the strategy moves to `partial_lp`
- `delegate-failed`: provide completed, delegation failed, strategy moves to `partial_lp`
- `provide-pending-confirmation`: existing provide hash has not confirmed yet, so the keeper does not double-send

Recovery sequence:

1. Inspect the latest execution for `provideTxHash` and `delegateTxHash`.
2. If the strategy is `partial_lp`, rerun the keeper tick after fixing the underlying issue or waiting for the LP balance to become visible.
3. The runner will retry delegation only when an LP delta is already present.

## Safe Rollout Checklist

1. Run `pnpm check`.
2. Run the local end-to-end flow:

   ```bash
   pnpm test test/e2e-local.test.ts -- --runInBand
   ```

3. Start the keeper in `dry-run` mode first.
4. Confirm execution rows are written with `status=simulated`.
5. Confirm positions update as expected after dry-run ticks.
6. Confirm `TARGET_POOL_ID` is the actual pair object address and that each strategy `inputDenom` resolves via `move.metadata(...)`.
7. Confirm `KEEPER_ADDRESS` matches the configured private key.
8. If using reward mode, confirm `LOCK_STAKING_MODULE_ADDRESS`, `LOCK_STAKING_MODULE_NAME`, and `LOCKUP_SECONDS` are set.
9. Keep the first live runs limited to small testnet amounts until the quote parser has been validated against your exact pool and denom set.
