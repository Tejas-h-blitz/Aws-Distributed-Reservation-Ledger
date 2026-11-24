import { strict as assert } from "node:assert";
import { MemoryIdempotencyStore } from "../../src/utils/idempotency";

async function run(): Promise<void> {
  const store = new MemoryIdempotencyStore();
  const expiration = Math.floor(Date.now() / 1000) + 600;

  // TODO(me): Implement this test expectation after acquirePending.
  const first = await store.acquirePending("reservation-key", "payload-a", expiration);
  assert.deepEqual(first, { outcome: "ACQUIRED" });

  const duplicate = await store.acquirePending("reservation-key", "payload-a", expiration);
  assert.deepEqual(duplicate, { outcome: "PENDING" });

  const mismatch = await store.acquirePending("reservation-key", "payload-b", expiration);
  assert.deepEqual(mismatch, { outcome: "MISMATCH" });

  const complete = await store.completePending(
    "reservation-key",
    "payload-a",
    { statusCode: 202, reservationId: "hold-a" },
    expiration
  );
  assert.equal(complete, "COMPLETED");

  const replay = await store.acquirePending("reservation-key", "payload-a", expiration);
  assert.deepEqual(replay, {
    outcome: "COMPLETED",
    response: { statusCode: 202, reservationId: "hold-a" },
  });

  const stale = await store.completePending(
    "reservation-key",
    "payload-a",
    { statusCode: 202, reservationId: "hold-a" },
    expiration
  );
  assert.equal(stale, "COMPLETED");

  console.log("Conditional idempotency acquire scaffold PASSED.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
