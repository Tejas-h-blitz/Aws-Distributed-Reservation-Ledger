/**
 * Client Rate Limiting Verification Test
 * Asserts that client requests are restricted after exceeding the token bucket limit,
 * returning HTTP 429 with appropriate headers, while other clients remain unaffected.
 */
export async function runRateLimitTest(baseUrl: string): Promise<boolean> {
  console.log("\n=== 7. Rate Limiting Test ===");
  const eventId = "evt_rate_limit_test";
  const clientId = `client_ratelimit_${Date.now()}`;
  const otherClientId = `client_other_${Date.now()}`;

  // Seed stock level to ensure we don't get out-of-stock conflicts
  await fetch(`${baseUrl}/inventory/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, count: 20 }),
  });

  console.log(`Firing 10 consecutive requests for client: ${clientId} (burst limit = 10)...`);
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${baseUrl}/reserve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `key_rl_${clientId}_${i}`,
        "X-Client-Id": clientId,
      },
      body: JSON.stringify({
        EventID: eventId,
        UserID: `user_rl_${i}`,
      }),
    });

    if (res.status !== 202) {
      console.error(`  - Request ${i + 1} failed with status ${res.status}`);
      return false;
    }
  }

  console.log(`Firing 11th request for client: ${clientId} (expecting HTTP 429 Throttled)...`);
  const limitRes = await fetch(`${baseUrl}/reserve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `key_rl_${clientId}_limit`,
      "X-Client-Id": clientId,
    },
    body: JSON.stringify({
      EventID: eventId,
      UserID: "user_rl_blocked",
    }),
  });

  const body = await limitRes.json() as any;
  console.log(`  - 11th Request response status: ${limitRes.status}`);
  console.log(`  - Response payload: ${JSON.stringify(body)}`);
  
  const assert429 = limitRes.status === 429;
  const retryAfter = limitRes.headers.get("retry-after");
  console.log(`  - Retry-After header: ${retryAfter}`);
  
  const assertRetryAfter = retryAfter !== null && !isNaN(Number(retryAfter)) && Number(retryAfter) > 0;

  console.log(`Firing request from a different client: ${otherClientId} (expecting HTTP 202)...`);
  const otherRes = await fetch(`${baseUrl}/reserve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `key_rl_${otherClientId}_success`,
      "X-Client-Id": otherClientId,
    },
    body: JSON.stringify({
      EventID: eventId,
      UserID: "user_rl_other",
    }),
  });

  console.log(`  - Other client request status: ${otherRes.status}`);
  const assertOtherSuccess = otherRes.status === 202;

  const passed = assert429 && assertRetryAfter && assertOtherSuccess;
  console.log(`Outcome: ${passed ? "PASSED" : "FAILED"}`);
  return passed;
}
