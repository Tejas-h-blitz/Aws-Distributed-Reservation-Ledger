# Failures and Reproduction Status

## Phase 0 audit (2026-11-24)

This entry records source-inspection evidence. It does not claim that the
reproduction tests have run.

| Issue | What breaks / why | How found | Runtime reproduction |
|---|---|---|---|
| Duplicate compensation | Each invocation increments the selected inventory store; a versioned hold status update does not guard the increment. | Inspected `src/handlers/compensate.ts` and `src/repository/hold.dynamodb.ts`. | Not run yet. |
| Expired hold counted active | Reconciliation includes all `PENDING`/`SETTLED` holds without comparing expiration to current time. | Inspected `src/handlers/reconciliation.ts` and `src/repository/hold.interface.ts`. | Not run yet. |
| Redis inventory key retention | Inventory writes do not set a TTL; no cleanup path is present in the repository. | Inspected `src/repository/inventory.redis.ts`. | Not run yet; Docker is not installed on the audit host. |
| RDS Proxy / pooling premise | `pg.Pool` exists, but CDK provisions neither RDS nor RDS Proxy; Compose PostgreSQL is local. | Inspected `src/repository/ledger.postgres.ts`, `docker-compose.yml`, and `infra/lib/ed-drle-stack.ts`. | No missing-pooling failure to reproduce; the supplied claim is partly contradicted by the code. |

## Baseline measurement provenance

The README's `229.67 RPS` / `315 ms p95` and ignored
`test-results/metrics.json` are inconsistent and do not include a date, commit,
or environment. Neither has been used as a verified measurement. The current
load test is an in-memory local simulation and is not yet a script under
`/bench`; do not use either artifact as an AWS performance result.
