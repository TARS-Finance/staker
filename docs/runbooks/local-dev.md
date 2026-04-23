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

Those package entrypoints are not implemented yet; this runbook reserves the commands Phase 1 will fill in.
