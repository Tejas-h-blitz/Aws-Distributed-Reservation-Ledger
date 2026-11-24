# Phase 2 Correctness Design

## Idempotency

The memory idempotency store now supports atomic `ACQUIRED`, `PENDING`,
`COMPLETED`, `MISMATCH`, `STALE`, and repeated-completion outcomes. Records
carry a SHA-256 request payload hash, preventing an already-used key from
executing a different payload.

The in-memory implementation is a scaffold for the intended DynamoDB contract:

1. Conditionally create or claim `PENDING` by key.
2. Replay `COMPLETED` only when the request hash matches.
3. Reject hash mismatch.
4. Complete only the matching PENDING owner.

The DynamoDB store implementation remains intentionally incomplete.

## Compensation

Compensation reads the hold, transitions `PENDING -> CANCELLED` through the
state machine, and performs inventory return only when the transition changed
the hold. Repeated compensation receives a terminal-state/no-change result and
does not increment inventory again.

This fixes the memory reproduction, but crash consistency between hold status
and stock remains unresolved; an outbox or durable transition journal belongs
in a later phase.

## Expiry

Reconciliation now transitions expired `PENDING` holds to `EXPIRED` before
computing active stock. Active stock excludes `EXPIRED` and `CANCELLED` holds
and includes unexpired `PENDING` and `SETTLED` holds.

The consistency window is currently limited to reconciliation runs; no durable
expiry worker or exact Redis/DynamoDB consistency protocol exists.

## Redis retention

Inventory `SET` operations now use `REDIS_INVENTORY_TTL_SECONDS`, defaulting
to 86,400 seconds. The TTL bounds key retention.

This is a key-retention policy, not proof of Redis/DynamoDB consistency.
Redis loss, throttling, and live TTL behavior still require Docker or Redis
emulation.
