# Failures and Reproduction Status

## Phase 7 documentation

The original README's `229.67 RPS` / `315 ms p95` figures had no committed
provenance and contradicted the commit-qualified local results. Removed those
claims, labeled the existing result files as local-in-memory, and added a
benchmark report that explicitly rejects an apples-to-apples optimization
claim. Added a current design/evidence map, a v1-v2 comparison, and a
resume-claim worksheet tied to existing test and benchmark artifacts.

This phase changes documentation only; there is no documentation test suite.
The benchmark values in the report link to their committed raw JSON outputs.

## Phase 6 observability

The local RED/span unit test, W3C parent-propagation plus injected-payment
failure test, and console exporter test passed. The exporter test captured the
reserve and saga spans and verified their trace ID and parent span ID, as well
as the exported request counter. `npm run build`, `npm run test:phase6`, and
the complete local test suite passed.

The first full-suite attempt exposed a stale fixed 300 ms wait in the saga
compensation test. The payment mock has nested retries, so the test read the
hold before the background workflow completed. Replaced the fixed sleep with
bounded polling for a terminal hold state; the rerun observed `CANCELLED` and
restored stock.

These are local-process tests. The console exporter is not remote telemetry.
Custom CloudWatch RED export, AWS tracing, live dashboard/alert delivery, and
multi-instance trace propagation remain unverified.

`npm audit --omit=dev` reported four production dependency advisories: one
critical (`proxy-addr`), one high (`body-parser`), and two moderate (`qs` and
`uuid`). They are in the existing application dependency tree, not the added
OpenTelemetry packages. No automatic updates were applied; the suggested
`uuid` remediation is a breaking major-version change and the other dependency
updates should be handled in a separate, tested maintenance change.

## Phase 5 network resilience

The first policy test failed because `executeNetworkPolicy` was a TODO, then
passed after timeout, retry/jitter, and bounded attempt implementation.
The retry-storm comparison passed: 40 unprotected requests made 120 calls;
the protected run allowed 4 concurrent calls and shed 36.

PostgreSQL pooling is process-local `pg.Pool`; RDS/RDS Proxy remains
out of scope. Redis keep-alive and AWS SDK retries are not live-tested.

## Phase 3 fault-injection harness

The seeded harness (`424242`) passed crash, duplicate/delayed/reordered events,
retry storm, Redis-loss/fallback, DynamoDB-throttling, concurrent-contention,
and expiry-reconciliation scenarios. It passed all capacity, terminal-state,
no-double-booking, exact-stock-return, and no-leaked-active-hold checks.

This evidence is local and in-memory only. It does not prove real network
partitions, Redis loss, DynamoDB throttle behavior, PostgreSQL connection
pressure, or AWS Lambda crash/restart semantics.

## Phase 2 correctness work

- Duplicate compensation reproduction: passed after compensation became a
  state transition no-op on replay.
- Expired-hold reconciliation reproduction: passed after reconciliation
  transitions expired PENDING holds and excludes them from active stock.
- Redis key-retention reproduction: passed after `SET ... EX` was added.
- Idempotency acquire/complete scaffold: passed in memory.
- Existing local integration suite: all 8 pipelines passed; load metrics were
  259.47 RPS, p50 180 ms, p95 261 ms, p99 261 ms.

Not solved: DynamoDB idempotency is still a TODO placeholder, and its
conditional acquire/complete operations are not implemented. Redis TTL is a
best-effort bounded-key policy, not a reconciliation consistency guarantee.
Connection pooling has not changed; `pg.Pool` exists and RDS/RDS Proxy do not.

## Phase 1 lifecycle modeling

No production behavior was fixed in Phase 1. The service and tests only model
states and allowed transitions. In particular, `PENDING -> COMPENSATED` can be
validated without proving that compensation inventory increments occur exactly
once; that requires conditional/idempotent compensation work in Phase 2.

## Phase 0 audit (2026-11-24)

The three applicable local reproductions were run with Node `v22.17.1` on
Windows and failed against v1 as intended. No production source code was
changed.

| Issue | What breaks / why | How found | Runtime reproduction |
|---|---|---|---|
| Duplicate compensation | Each invocation increments the selected inventory store; a versioned hold status update does not guard the increment. | `tests/phase0/compensation-idempotency.test.ts` invokes compensation twice. | Failed as expected: actual stock `2`, expected `1`. |
| Expired hold counted active | Reconciliation includes all `PENDING`/`SETTLED` holds without comparing expiration to current time. | `tests/phase0/expired-hold-reconciliation.test.ts` seeds an expired pending hold. | Failed as expected: actual Redis-model stock `0`, expected `1`. |
| Redis inventory key retention | Inventory writes do not set a TTL; no cleanup path is present in the repository. | `tests/phase0/redis-inventory-retention.test.ts` captures repository-issued Redis commands with a fake client. | Failed as expected: no expiry command/option was issued. This is a command-shape unit test, not a live Redis TTL test; Docker is unavailable. |
| RDS Proxy / pooling premise | `pg.Pool` exists, but CDK provisions neither RDS nor RDS Proxy; Compose PostgreSQL is local. | Inspected `src/repository/ledger.postgres.ts`, `docker-compose.yml`, and `infra/lib/ed-drle-stack.ts`. | No failing test added: “no client-side pooling” is false for this code; no RDS endpoint exists to assess proxy behavior. |
| Cloud/local saga input contract | Stream event fields and Step Functions task state do not preserve the reservation fields required by payment, ledger, and compensation handlers. The local simulator supplies a different shape. | Inspected `src/handlers/stream-publisher.ts`, `infra/lib/ed-drle-stack.ts`, and the handler input checks. | Static finding only. Add a focused repro before changing this workflow; not part of the three run gap tests above. |

The three reproduction commands exited with code 1 on commit
`f283bfe` (`test: add reproducible v1 correctness failures`). Their assertion
failures were the evidence sought; these are not unresolved test-run errors.

## Baseline measurement provenance

The README's `229.67 RPS` / `315 ms p95` and ignored
`test-results/metrics.json` are inconsistent and lack date, commit, and
environment provenance. The committed local baseline at
[`bench/results/v1-load-2026-11-24T10-56-43-480Z.json`](../bench/results/v1-load-2026-11-24T10-56-43-480Z.json)
records `357.91 RPS`, `p50 112 ms`, `p95 201 ms`, `p99 213 ms`, and 500 HTTP
202 responses with zero errors. It uses in-memory adapters, bypasses the rate
limiter, and is not an AWS or Docker-backed measurement.
