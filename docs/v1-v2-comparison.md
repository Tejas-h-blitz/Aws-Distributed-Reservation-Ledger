# ED-DRLE v1-to-v2 Comparison

The `v1.0` tag marks the audited starting point. This comparison reflects the
committed v2 work through Phase 6. “Implemented” refers to repository behavior
and local evidence; it does not imply a deployed AWS system.

| Area | v1 audited state | v2 work and evidence | Remaining limit |
|---|---|---|---|
| Reservation lifecycle | Status values existed without a central transition contract. | Added an explicit hold state machine and transition tests. | A valid state transition does not make cross-store side effects atomic. |
| Compensation | Repeated compensation could increment inventory more than once. | Compensation uses a state transition to gate the inventory return; replay tests and the seeded harness cover the memory path. | A crash between hold transition and inventory update can still lose the return; no durable journal/outbox. |
| Expiry | Reconciliation counted expired pending holds as active. | Local reconciliation transitions expired pending holds to `EXPIRED`; modeled expiry checks pass. | No durable expiry worker or defined Redis/DynamoDB consistency window. |
| Redis key retention | Inventory keys had no TTL. | Redis `SET` applies `REDIS_INVENTORY_TTL_SECONDS`, default 86,400 seconds. | TTL bounds retention but is not synchronized to event/hold lifecycle; no live Redis TTL test. |
| Idempotency | The starting implementation did not provide the current payload-bound acquire/complete contract. | Memory adapter binds a key to a request hash and supports replay-safe completion. | DynamoDB acquire/complete remains unimplemented; cloud behavior is not proved. |
| Fault injection | No seeded invariant harness was recorded in the v1 audit. | Added a deterministic in-memory fault harness for saga interruption, replays, retry storms, store loss/throttling, contention, and expiry. | Model tests do not emulate network partitions, AWS process restarts, or service quotas. |
| Network resilience | Downstream timeout/retry behavior was inconsistent. | Added bounded attempts, timeout, capped full jitter, in-process load shedding, and PostgreSQL pool bounds. | `Promise.race` does not cancel timed-out work; load shedding is process-local; live service behavior is untested. |
| PostgreSQL connectivity | `pg.Pool` already existed; CDK did not define RDS or RDS Proxy. | Added configurable pool bounds/timeouts. | No RDS or RDS Proxy is provisioned. The original “no connection pooling” premise was inaccurate. |
| Observability | Structured logs existed without OpenTelemetry spans and RED metric export. | Added local RED instruments, W3C trace context, reserve-to-saga step spans, bounded snapshots, and opt-in console export. | No remote collector, AWS export, deployed dashboard, alert delivery, or multi-instance propagation test. |
| Performance evidence | README figures were not backed by a commit-qualified benchmark. | Added scripts and raw, commit-qualified local-in-memory benchmark results. | Results do not represent AWS or a controlled optimization gain; 10,000 RPS remains unverified. |

Supporting evidence:

- [v1 as-is audit](as-is-architecture.md)
- [Phase 2 correctness](phase2-correctness.md)
- [Phase 3 fault injection](phase3-fault-injection.md)
- [Phase 4 benchmark analysis](benchmark-report.md)
- [Phase 5 network resilience](phase5-network-resilience.md)
- [Phase 6 observability](phase6-observability.md)
- [Failures and unresolved issues](failures.md)
