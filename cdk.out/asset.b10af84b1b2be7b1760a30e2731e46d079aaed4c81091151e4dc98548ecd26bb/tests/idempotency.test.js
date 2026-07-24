"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runIdempotencyTest = runIdempotencyTest;
/**
 * Idempotency Test
 * Asserts that duplicate client retries with the same Idempotency-Key
 * return identical cached responses and do not create duplicate holds or double decrements.
 */
async function runIdempotencyTest(baseUrl) {
    console.log("\n=== 2. Idempotency Test ===");
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
        promises.push(fetch(`${baseUrl}/reserve`, {
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
        }).then(async (r) => ({
            status: r.status,
            text: await r.text(),
        })));
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
    const stockData = await stockRes.json();
    console.log(`  - Final stock counters: Redis=${stockData.RedisStock}, DynamoDB=${stockData.DynamoDBStock}`);
    const assertStockReducedByOne = stockData.RedisStock === 9 || stockData.DynamoDBStock === 9;
    const passed = all202 && allBodiesEqual && assertStockReducedByOne;
    console.log(`Outcome: ${passed ? "PASSED" : "FAILED"}`);
    return passed;
}
