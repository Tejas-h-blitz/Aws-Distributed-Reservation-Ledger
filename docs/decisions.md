# Decisions

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
  but defers a valid performance baseline until the harness is committed and
  run.

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
