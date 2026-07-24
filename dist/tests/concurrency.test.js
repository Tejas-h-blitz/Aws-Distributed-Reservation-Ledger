"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConcurrencyTest = runConcurrencyTest;
/**
 * Concurrency Test
 * Asserts that under concurrent load, exactly 1 reservation succeeds for 1 unit of stock.
 */
async function runConcurrencyTest(baseUrl) {
    console.log("\n=== 1. Concurrency Test ===");
    const eventId = "evt_concurrency_stress";
    // Seed stock level to 1
    await fetch(`${baseUrl}/inventory/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, count: 1 }),
    });
    const requestCount = 50;
    const promises = [];
    console.log(`Firing ${requestCount} concurrent reservation requests at 1 unit of stock...`);
    for (let i = 0; i < requestCount; i++) {
        promises.push(fetch(`${baseUrl}/reserve`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": `key_concurrency_user_${i}`,
            },
            body: JSON.stringify({
                EventID: eventId,
                UserID: `user_concurrency_${i}`,
                HoldID: `hold_concurrency_${i}`,
            }),
        }).then(async (r) => ({
            status: r.status,
            body: await r.json(),
        })));
    }
    const results = await Promise.all(promises);
    const succeeded = results.filter(r => r.status === 202);
    const outOfStock = results.filter(r => r.status === 409);
    const otherResponses = results.filter(r => r.status !== 202 && r.status !== 409);
    console.log(`Results:`);
    console.log(`  - 202 Accepted (Succeeded): ${succeeded.length}`);
    console.log(`  - 409 Conflict (Out of Stock): ${outOfStock.length}`);
    if (otherResponses.length > 0) {
        console.log(`  - Other responses: ${otherResponses.length}`, otherResponses);
    }
    // Fetch final stock
    const stockRes = await fetch(`${baseUrl}/inventory/${eventId}`);
    const stockData = await stockRes.json();
    console.log(`  - Final live stock counters: Redis=${stockData.RedisStock}, DynamoDB=${stockData.DynamoDBStock}`);
    // Assertions
    const assertSuccessCount = succeeded.length === 1;
    const assertFailureCount = outOfStock.length === requestCount - 1;
    const assertZeroStock = stockData.RedisStock === 0 || stockData.DynamoDBStock === 0;
    const passed = assertSuccessCount && assertFailureCount && assertZeroStock;
    console.log(`Outcome: ${passed ? "PASSED" : "FAILED"}`);
    return passed;
}
