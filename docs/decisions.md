# Decisions

## Phase 6: local RED metrics and trace spans

- **Problem:** Structured logs existed, but there was no local RED snapshot or
  saga span object proving an injected failure end-to-end.
- **Options:** Add OpenTelemetry SDK/exporters, use only existing CloudWatch
  infrastructure, or add a small dependency-free local implementation.
- **Choice:** Add a local RED snapshot and trace-span collector, exposed from
  the Express emulator at `GET /observability`. Existing correlation IDs remain
  the trace key. Do not add a new dependency without explicit approval.
- **Trade-off:** This proves local instrumentation and injected failure
  correlation, but it does not fulfill OpenTelemetry export, a live dashboard,
  or AWS alarm delivery. Those remain explicitly incomplete.

## Phase 5: centralized network resilience

- **Problem:** Downstream calls had inconsistent timeout/retry behavior and no
  shared backpressure boundary.
- **Options:** Central policy, per-repository retries, or SDK defaults.
- **Choice:** Add a shared `executeNetworkPolicy` with per-call timeout,
  exponential/capped full jitter, bounded attempts, and optional concurrency
  load shedding. Wire it into the payment mock and configure the PostgreSQL
  pool (`max`, idle timeout, connection timeout).
- **Trade-off:** The policy bounds one process's concurrency but is not a
  distributed semaphore. Redis keep-alive and command deadlines remain to be
  verified against a real Redis process. AWS SDK retry layers may compose with
  this policy; timeout/retry budgets must be coordinated before cloud testing.

## Phase 3: seeded fault-injection harness

- **Problem:** Correctness claims need post-event invariant checks across
  crashes, replay, throttling, and contention.
- **Options:** Start with AWS resources, Docker-backed real services, or a
  seeded in-memory event/model harness.
- **Choice:** Use a deterministic in-memory harness with seed `424242`. It
  checks capacity, terminal-state, no-double-booking, retry, expiry, and
  compensation invariants after each scenario.
- **Trade-off:** The harness proves state-machine behavior under modeled faults,
  not network partitions, Redis durability, DynamoDB conditional-write semantics,
  or AWS service behavior. Docker/AWS verification remains deferred.

## Phase 2: idempotency and bounded correctness fixes

- **Problem:** Replayed compensation and expired holds could not be made safe
  because idempotency claims were not atomic and state transitions were direct.
- **Options:** Add a response-only cache, add Redis locks, or make PENDING/
  COMPLETED records with conditional ownership and payload binding.
- **Choice:** Implement PENDING/COMPLETED ownership and payload hashes in the
  idempotency interface and memory store. Compensation now uses the lifecycle
  state machine so a replay becomes a no-op. Reconciliation expires PENDING
  holds before counting active stock. Redis inventory `SET` now accepts an
  environment-configured TTL, defaulting to 24 hours.
- **Trade-off:** The DynamoDB idempotency implementation remains TODO. The
  TTL value protects the Redis key-retention problem but may expire inventory
  state independently of event lifecycle, so Phase 2 does not claim DynamoDB/
  Redis consistency. RDS remains unchanged.

## Phase 1: reservation lifecycle state machine

- **Problem:** The hold record has an enum and handlers call status updates
  directly, with no central definition of legal transitions.
- **Options:** Keep the existing statuses and validate transitions in handlers;
  add a dedicated transition service; or build an outbox-backed state machine.
- **Choice:** Add a dedicated `HoldStateMachine` service over `HoldRepository`.
  It allows `PENDING` to become `SETTLED`, `CANCELLED`, `EXPIRED`, or
  `COMPENSATED`; terminal states are absorbing; repeated transitions to the
  same state are idempotent no-op results.
- **Trade-off:** This centralizes lifecycle rules without changing storage or
  adding a new service/dependency. It does not yet enforce these rules inside
  handlers or persist transition journals.

## Phase 0: evidence boundaries and as-is architecture

- **Problem:** The README and supplied project context describe a production-like
  AWS system, but local tests, infrastructure declarations, and checked-in
  measurements do not all support those claims.
- **Options:** Treat README prose and `test-results/metrics.json` as measured
  truth; or distinguish source-declared architecture, local simulation, and
  reproducible measurements.
- **Choice:** Keep those evidence classes separate. The as-is diagram and
  capacity arithmetic are based on source inspection; README/load-result
  numbers remain unverified until produced by a committed `/bench` script with
  provenance.
- **Trade-off:** This avoids presenting stale or untraceable numbers as results,
  and makes the local-only baseline reproducible; it does not provide a cloud
  capacity estimate.

## Phase 0: baseline workload

- **Problem:** The existing benchmark measures 500 requests in sequential
  batches of 50 but does not preserve provenance or raw latency samples.
- **Options:** Change the v1 load profile during the audit; or retain its
  request count, batch size, local in-memory adapters, and rate-limit bypass
  while adding provenance and saving samples.
- **Choice:** Preserve the existing workload and label the result
  `local-in-memory`; save the commit, date, environment, status counts, and
  latency samples in `/bench/results`.
- **Trade-off:** This enables an apples-to-apples local comparison with the
  existing test while explicitly not representing Redis, PostgreSQL, AWS, or
  the target production capacity.

## RDS / connection-pooling claim

- **Problem:** The supplied gap says there is no RDS Proxy / connection pooling.
- **Options:** Add an RDS Proxy immediately; or first verify whether RDS exists
  and whether application-side pooling is present.
- **Choice:** No infrastructure or dependency change during the audit. Source
  inspection found `pg.Pool`, a local PostgreSQL Compose service, and no RDS or
  RDS Proxy resources in CDK. Revisit a proxy only after an AWS database design
  and measurements justify it.
- **Trade-off:** The existing pool only pools within each process and does not
  multiplex connections across Lambda environments; however, adding a proxy
  before an RDS deployment is defined would be unsupported scope.
