# Phase 3 Fault-Injection and Invariants

## Harness

The harness is deterministic:

- Seed: `424242`
- Runtime: Node.js local process
- Storage: memory inventory, hold, ledger, and idempotency repositories
- Command: `node_modules\.bin\ts-node.cmd tests\phase3\fault-injection-harness.ts`

No Docker or AWS resources are used.

## Scenarios

1. Crash mid-saga: decrement stock, create a PENDING hold, then recover as
   `COMPENSATED` and restore exactly one unit.
2. Duplicate/delayed/reordered events: deliver cancellation transitions in
   seeded random order and verify replay is idempotent.
3. Retry storm: replay compensation 100 times.
4. Redis loss/fallback: mark the primary unreachable and use fallback stock.
5. DynamoDB throttling: fail three status updates with `ThrottlingException`,
   then retry until the terminal state is written.
6. Concurrent contention: 50 simulated reservations compete for one unit.
7. Expiry reconciliation: expire a PENDING hold and reconcile active stock.

## Invariants

- Capacity never exceeds the configured total.
- A hold has at most one successful terminal transition.
- Compensation takes effect at most once.
- Retry storms do not increase or return stock beyond capacity.
- Concurrent contention does not double-book one resource.
- Expiry reconciliation leaves no PENDING/SETTLED hold as an active leak.

## Still unresolved

The harness does not replace live fault-injection testing. It cannot observe
network packet loss, real Redis eviction, DynamoDB conditional-write races,
PostgreSQL transaction rollback, Lambda process restarts, or AWS quota limits.
