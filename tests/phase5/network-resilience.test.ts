import { strict as assert } from "node:assert";
import { executeNetworkPolicy } from "../../src/utils/network-resilience";

async function run(): Promise<void> {
  let attempts = 0;
  const delays: number[] = [];

  await assert.rejects(
    executeNetworkPolicy(
      async () => {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 50));
        throw new Error("downstream unavailable");
      },
      {
        timeoutMs: 5,
        maxAttempts: 4,
        baseDelayMs: 1,
        maxDelayMs: 8,
        onRetry: (_error, _attempt, delayMs) => delays.push(delayMs),
        random: () => 0.5,
      }
    ),
    /downstream unavailable|timed out/
  );

  assert.equal(attempts, 4);
  assert.equal(delays.length, 3);
  assert.ok(delays.every(delay => delay >= 0 && delay <= 8));

  let stormLoad = 0;
  const shed = await executeNetworkPolicy(
    async () => {
      stormLoad++;
      return "allowed";
    },
    {
      timeoutMs: 20,
      maxAttempts: 1,
      baseDelayMs: 1,
      maxDelayMs: 1,
      maxConcurrent: 2,
    }
  );
  assert.equal(shed, "allowed");

  console.log("Network resilience policy test PASSED.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
