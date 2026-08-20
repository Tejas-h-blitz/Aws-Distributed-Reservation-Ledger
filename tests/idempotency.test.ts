import { MemoryIdempotencyStore } from "../src/utils/idempotency";

export async function runIdempotencyTest(baseUrl: string): Promise<boolean> {
  console.log("\n=== 2. Idempotency Test ===");

  // Direct Unit Tests for MemoryIdempotencyStore
  console.log("Running MemoryIdempotencyStore unit tests...");
  const store = new MemoryIdempotencyStore(50); // cleanup every 50ms
  
  // 1. Save and retrieve record
  const key1 = "test_key_1";
  const exp1 = Math.floor(Date.now() / 1000) + 2; // expires in 2s
  await store.saveRecord(key1, { status: "COMPLETED", response: { ok: true }, expirationTime: exp1 });
  const rec1 = await store.getRecord(key1);
  if (!rec1 || rec1.status !== "COMPLETED" || !rec1.response.ok) {
    console.error("MemoryIdempotencyStore Unit Test Failed: Could not save/retrieve record");
    store.stopCleanup();
    return false;
  }

  // 2. Check periodic cleanup of expired items
  const key2 = "test_key_2";
  const exp2 = Math.floor(Date.now() / 1000) - 1; // already expired
  await store.saveRecord(key2, { status: "COMPLETED", response: { ok: true }, expirationTime: exp2 });
  
  // At this point, key2 is expired, size should be 2 initially (key1 and key2)
  if (store.getCacheSize() !== 2) {
    console.error(`MemoryIdempotencyStore Unit Test Failed: Expected size 2, got ${store.getCacheSize()}`);
    store.stopCleanup();
    return false;
  }

  // Wait for 100ms for cleanup interval to fire
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // After interval fires, key2 should be pruned.
  if (store.getCacheSize() > 1) {
    console.error(`MemoryIdempotencyStore Unit Test Failed: Expected expired records to be cleaned up, got size ${store.getCacheSize()}`);
    store.stopCleanup();
    return false;
  }
  
  store.stopCleanup();
  console.log("MemoryIdempotencyStore unit tests PASSED.");

  const eventId = "evt_idempotency_safety";
  const idempotencyKey = "key_idempotence_retry_456";
  const holdId = "hold_idempotence_retry_456";

  // Seed stock to 10
  await fetch(`${baseUrl}/inventory/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, count: 10 }),
  });

  const requestCount = 5;
  const promises = [];

  console.log(`Firing ${requestCount} parallel requests with identical Idempotency-Key: ${idempotencyKey}...`);

  for (let i = 0; i < requestCount; i++) {
    promises.push(
      fetch(`${baseUrl}/reserve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          EventID: eventId,
          UserID: "user_idempotent_consumer",
          HoldID: holdId,
        }),
      }).then(async r => ({
        status: r.status,
        text: await r.text(),
      }))
    );
  }

  const results = await Promise.all(promises);

  console.log("Responses received:");
  results.forEach((r, i) => {
    console.log(`  - Response #${i + 1}: HTTP ${r.status}, Payload: ${r.text}`);
  });

  // Assertions
  const statuses = results.map(r => r.status);
  const bodies = results.map(r => r.text);

  const all202 = statuses.every(s => s === 202);
  const allBodiesEqual = bodies.every(b => b === bodies[0]);

  // Fetch final stock
  const stockRes = await fetch(`${baseUrl}/inventory/${eventId}`);
  const stockData = await stockRes.json() as any;
  console.log(`  - Final stock counters: Redis=${stockData.RedisStock}, DynamoDB=${stockData.DynamoDBStock}`);

  const assertStockReducedByOne = stockData.RedisStock === 9 || stockData.DynamoDBStock === 9;

  const passed = all202 && allBodiesEqual && assertStockReducedByOne;
  console.log(`Outcome: ${passed ? "PASSED" : "FAILED"}`);
  return passed;
}
