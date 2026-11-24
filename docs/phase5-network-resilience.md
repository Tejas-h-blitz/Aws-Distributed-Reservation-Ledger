# Phase 5 Network Resilience

## Policy

`executeNetworkPolicy` provides:

- Per-call timeout via `Promise.race`
- Bounded attempts
- Exponential, capped full jitter
- Optional in-process concurrency load shedding
- Retry callback hooks

Environment-facing payment defaults:

- `PAYMENT_TIMEOUT_MS=500`
- `PAYMENT_MAX_ATTEMPTS=3`
- `PAYMENT_BACKOFF_BASE_MS=25`
- `PAYMENT_BACKOFF_MAX_MS=250`

PostgreSQL pool defaults:

- `DB_POOL_MAX=10`
- `DB_IDLE_TIMEOUT_MS=30000`
- `DB_CONNECTION_TIMEOUT_MS=5000`

## Circuit breaker interaction

The payment mock combines the existing circuit breaker with the network policy.
The breaker rejects open calls before timeout/retry work begins. The network
policy records only each call it is allowed to execute; retry amplification
remains bounded by `maxAttempts`.

## Retry-storm evidence

The local comparison test:

- Without protection: 40 requests × 3 conceptual attempts = 120 downstream calls.
- With `maxConcurrent=4`: 4 calls allowed, 36 rejected by load shedding.

This proves local backpressure behavior only. It does not prove distributed
load shedding across multiple processes or hosts.

## Limits

- No live Redis command timeout/keep-alive test.
- No live AWS SDK retry test.
- No RDS/RDS Proxy deployment or billable resource test.
- The in-process limiter is not a distributed semaphore.
