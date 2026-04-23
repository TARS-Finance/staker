# ADR 0001: Backend-First Keeper

## Status

Accepted

## Context

The service needs to automate per-user Initia actions:

- provide single-asset liquidity into a target INIT pool
- delegate the resulting LP position

The product scope explicitly excludes:

- pooled user vaults
- cross-chain routing
- frontend-first delivery
- raw private-key custody

The system also needs a safe verification path before any live testnet writes occur.

## Decision

We use a backend-first architecture with:

- `apps/api` for user registration, strategy setup, grant preparation, and status reads
- `apps/keeper` for scheduled execution and reconciliation
- `packages/db` for persistence
- `packages/chain` for Initia authz, feegrant, and execution encoding
- `scripts/mock-fe.ts` as the initial onboarding surrogate instead of a full frontend

The keeper runs one strategy per user. It does not pool balances across users.

For safety, Phase 5 adds `KEEPER_MODE=dry-run|live`. Dry-run mode:

- builds real `MsgExec` payloads
- avoids broadcast
- records executions as `simulated`
- updates synthetic balances so reconciliation and positions can be verified locally

## Consequences

### Positive

- API and keeper can be reviewed independently.
- User onboarding can be exercised before a frontend is built.
- Dry-run mode provides a stable pre-live validation path.
- The keeper logic is testable without chain access.

### Negative

- The current live mode is still a placeholder until a real chain client is implemented.
- Dry-run balances are synthetic and not a price-accurate market simulation.
- The database is required even for local verification flows.

## Follow-Up

- Replace the live placeholder chain client with a real Initia client.
- Add structured logging and dry-run report storage if operator review needs become heavier.
- Expand the end-to-end tests once live-mode broadcast and confirmation logic exist.
