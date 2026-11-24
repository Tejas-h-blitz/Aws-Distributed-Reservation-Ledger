import { strict as assert } from "node:assert";
import {
  executeNetworkPolicy,
  LoadSheddingError,
} from "../../src/utils/network-resilience";

async function run(): Promise<void> {
  let calls = 0;
  const requestCount = 40;
  const withoutProtection = await Promise.all(
    Array.from({ length: requestCount }, async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      return "completed";
    })
  );
  assert.equal(withoutProtection.length, requestCount);
  assert.equal(calls, 120);

  let allowed = 0;
  let rejected = 0;
  await Promise.all(
    Array.from({ length: requestCount }, async () => {
      try {
        await executeNetworkPolicy(
          async () => {
            await new Promise(resolve => setTimeout(resolve, 5));
            return "allowed";
          },
          {
            timeoutMs: 20,
            maxAttempts: 1,
            baseDelayMs: 1,
            maxDelayMs: 1,
            maxConcurrent: 4,
          }
        );
        allowed++;
      } catch (error) {
        if (error instanceof LoadSheddingError) {
          rejected++;
        } else {
          throw error;
        }
      }
    })
  );

  assert.ok(allowed <= 4);
  assert.equal(allowed + rejected, requestCount);
  assert.ok(rejected > allowed);

  console.log(
    `Retry storm comparison PASSED: protected allowed=${allowed}, rejected=${rejected}, unprotectedCalls=${calls}`
  );
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
