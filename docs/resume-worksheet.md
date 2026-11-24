# ED-DRLE Resume Worksheet — Verified Claims Only

Use the draft bullets below only with their evidence and limits. Keep “local,
in-memory” visible anywhere a benchmark or test result is mentioned. Do not
present repository code as a deployed AWS system.

## Evidence-backed draft bullets

- Built a deterministic, in-memory fault-injection harness for reservation
  lifecycle failures, retries, duplicate/reordered events, simulated store
  failures, contention, and expiry; verified modeled capacity and
  compensation invariants. Evidence: [Phase 3 report](phase3-fault-injection.md).

- Implemented payload-bound idempotency and replay-safe compensation in the
  memory adapter, plus local expiry reconciliation and configurable Redis key
  TTL. Caveat: DynamoDB idempotency and crash-atomic cross-store compensation
  remain incomplete. Evidence: [Phase 2 design](phase2-correctness.md).

- Instrumented the local reserve and saga paths with OpenTelemetry trace
  context, step spans, RED metrics, and opt-in console export; tested W3C
  parent-child propagation and injected payment failure. Caveat: no remote
  collector or AWS telemetry was verified. Evidence:
  [Phase 6 report](phase6-observability.md).

- Established a commit-qualified **local-in-memory** baseline of 357.91 RPS
  with p95 latency of 201 ms for 500 requests in batches of 50. Caveat: this
  bypasses local rate limiting and is not an AWS or production-capacity result.
  Evidence: [raw baseline result](../bench/results/v1-load-2026-11-24T10-56-43-480Z.json)
  and [benchmark analysis](benchmark-report.md).

## Do not claim yet

- “Supports 10,000 RPS,” “production-ready,” or an AWS performance result.
- DynamoDB-backed payload idempotency or exactly-once compensation across
  stores.
- A measured performance improvement from the logging change; the recorded
  before/after runs are not controlled and the later p95/p99 are higher.
- RDS Proxy, deployed RDS, distributed load shedding, or live Redis/DynamoDB
  reconciliation.
- Remote OpenTelemetry export, a deployed dashboard, or verified alert
  delivery.

## Before using a bullet

1. Can the claim be traced to a committed test, source change, or raw benchmark
   result?
2. Is the environment (`local-in-memory` or `AWS`) stated accurately?
3. Does the wording distinguish modeled behavior from live service behavior?
4. Are limitations material to the claim included rather than implied away?
5. Does every performance number match a committed file under `bench/results/`?

Remove any bullet that does not pass all five checks.
