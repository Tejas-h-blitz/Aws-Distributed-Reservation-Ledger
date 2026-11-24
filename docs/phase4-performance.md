# Phase 4 Performance

## Baseline and profiling

The baseline and optimization runs use 500 reserve requests in batches of 50,
with in-memory repositories and rate limiting bypassed because no client ID is
present.

Commit-qualified evidence:

- Phase 0 local baseline:
  357.91 RPS, p50 112 ms, p95 201 ms, p99 213 ms.
- After the logging optimization:
  335.57 RPS, p50 97 ms, p95 449 ms, p99 511 ms
  (`v1-load-2026-11-24T12-19-02-732Z.json`).
- Hot-key test:
  297.27 RPS, p50 90 ms, p95 603 ms, p99 677 ms
  (`hot-key-2026-11-24T12-19-02-922Z.json`).

The commit-qualified logging-change result has lower throughput and higher
p95/p99 latency than the baseline. Since the runs use different source
commits, this evidence does not establish a controlled gain or attribute the
observed differences to the logging change. See the
[benchmark report](benchmark-report.md) for interpretation and raw files.

Exploratory evidence (not used as the commit-qualified before/after result):

- Normal post-Phase-2/Phase-3 run: 55.05 RPS, p50 252 ms, p95 3292 ms,
  p99 3317 ms.
- Run with stdout redirected: 124.84 RPS, p50 343 ms, p95 611 ms,
  p99 637 ms.
- Working-tree logging optimization: 506.59 RPS, p50 65 ms, p95 230 ms,
  p99 233 ms.

The profiler-distorted run is not compared as a performance baseline:
Node CPU instrumentation produced 32.24 RPS and 3442 ms p95.

## Bottleneck evidence

Redirecting stdout improved throughput and latency, while CPU profile output
showed substantial time in `logger.log/info/error`, JSON serialization,
`console.log`, and fetch/HTTP overhead. The proposed bottleneck is therefore
structured stdout emission in local test mode, not memory inventory or hold-map
operations.

The one-at-a-time optimization suppresses stdout emission only when
`LOCAL_TESTING=true` and no test observability listener is registered. Normal
and AWS environments continue to emit JSON logs.

## Not claimed

These runs do not prove AWS throughput, real Redis/PostgreSQL/DynamoDB latency,
or cloud 10,000 RPS capacity. Docker and AWS load testing remain separate
environmental limits.
