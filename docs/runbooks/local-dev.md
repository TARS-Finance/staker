# Local Development

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker

## First-Time Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

3. Start PostgreSQL:

   ```bash
   docker-compose up -d
   ```

## Validation Commands

- Run all local checks:

  ```bash
  ./scripts/run-local-checks.sh
  ```

## Planned App Entry Points

- API app:

  ```bash
  pnpm --filter @stacker/api dev
  ```

- Keeper app:

  ```bash
  pnpm --filter @stacker/keeper dev
  ```

The keeper supports two modes:

- Dry-run:

  ```bash
  KEEPER_MODE=dry-run KEEPER_DRY_RUN_INPUT_BALANCE=1000 pnpm --filter @stacker/keeper dev
  ```

- Live:

  ```bash
  KEEPER_MODE=live pnpm --filter @stacker/keeper dev
  ```

Live mode requires:

- `KEEPER_PRIVATE_KEY` to be a hex-encoded Initia private key
- `KEEPER_ADDRESS` to match the address derived from that key
- `TARGET_POOL_ID` to be the pair object address used by InitiaDEX
