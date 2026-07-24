/**
 * Chaos Test
 * Simulates Redis outage and verifies that the system falls back to DynamoDB
 * counter stores, maintaining consistency without overselling.
 */
export async function runChaosTest(baseUrl: string): Promise<boolean> {
  console.log("\n=== 3. Chaos Test (Redis Outage Fallback) ===");
  const eventId = "evt_chaos_outage_test";

  // Seed stock level to 1
  await fetch(`${baseUrl}/inventory/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, count: 1 }),
  });

  // 1. Inject Chaos: Toggle Redis offline
  console.log("Injecting Redis connection failure...");
  const toggleRes = await fetch(`${baseUrl}/chaos/redis/toggle`, { method: "POST" });
  const toggleData = await toggleRes.json() as any;
  console.log(`  - Chaos State: Redis Simulated Offline = ${toggleData.redisOffline}`);

  const requestCount = 20;
  const promises = [];

  console.log(`Firing ${requestCount} concurrent requests during Redis outage...`);

  for (let i = 0; i < requestCount; i++) {
    promises.push(
      fetch(`${baseUrl}/reserve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `key_chaos_user_${i}`,
        },
        body: JSON.stringify({
          EventID: eventId,
          UserID: `user_chaos_${i}`,
          HoldID: `hold_chaos_${i}`,
        }),
      }).then(async r => ({
        status: r.status,
        body: await r.json() as any,
      }))
    );
  }

  const results = await Promise.all(promises);

  const succeeded = results.filter(r => r.status === 202);
  const outOfStock = results.filter(r => r.status === 409);

  console.log(`Outage Results:`);
  console.log(`  - 202 Accepted (Succeeded via fallback): ${succeeded.length}`);
  console.log(`  - 409 Conflict (Out of stock fallback): ${outOfStock.length}`);

  if (succeeded.length > 0) {
    console.log(`  - Successful fallback hold response detail:`, succeeded[0].body);
  }

  // 2. Recover: Toggle Redis back online
  console.log("Restoring Redis connection...");
  const restoreRes = await fetch(`${baseUrl}/chaos/redis/toggle`, { method: "POST" });
  const restoreData = await restoreRes.json() as any;
  console.log(`  - Chaos State Restored: Redis Simulated Offline = ${restoreData.redisOffline}`);

  // Fetch final stock
  const stockRes = await fetch(`${baseUrl}/inventory/${eventId}`);
  const stockData = await stockRes.json() as any;
  console.log(`  - Final stock counters: Redis=${stockData.RedisStock}, DynamoDB=${stockData.DynamoDBStock}`);

  // Assertions
  const assertSuccessCount = succeeded.length === 1;
  const assertFailureCount = outOfStock.length === requestCount - 1;
  const assertUsedFallback = succeeded.length > 0 && succeeded[0].body.UsedFallbackStore === true;
  const assertZeroStock = stockData.DynamoDBStock === 0;

  const passed = assertSuccessCount && assertFailureCount && assertUsedFallback && assertZeroStock;
  console.log(`Outcome: ${passed ? "PASSED" : "FAILED"}`);
  return passed;
}
