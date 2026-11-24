# Decisions

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
