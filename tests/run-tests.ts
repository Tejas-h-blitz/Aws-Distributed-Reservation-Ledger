import { app } from "../src/local/local-server";
import { runConcurrencyTest } from "./concurrency.test";
import { runIdempotencyTest } from "./idempotency.test";
import { runChaosTest } from "./chaos.test";
import { runSagaTest } from "./saga.test";
import { runAuditTest } from "./audit.test";
import { runLoadTest } from "./load.test";
import { runRateLimitTest } from "./rate-limit.test";
import { runObservabilityTest } from "./observability.test";
import { Server } from "http";
 
// Enable testing mode in the Service locator registry
process.env.LOCAL_TESTING = "true";
process.env.PORT = "3000";
const baseUrl = "http://localhost:3000";
 
let serverInstance: Server;
 
async function startServer(): Promise<void> {
  return new Promise((resolve) => {
    serverInstance = app.listen(3000, () => {
      console.log("Local emulated API Gateway server running on port 3000...");
      resolve();
    });
  });
}
 
async function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => {
        console.log("Local emulated API Gateway server stopped.");
        resolve();
      });
    } else {
      resolve();
    }
  });
}
 
async function executeTestSuite() {
  await startServer();
  let allTestsPassed = true;
 
  try {
    // 1. Concurrency Test
    const concurrencyPassed = await runConcurrencyTest(baseUrl);
    if (!concurrencyPassed) allTestsPassed = false;
 
    // 2. Idempotency Test
    const idempotencyPassed = await runIdempotencyTest(baseUrl);
    if (!idempotencyPassed) allTestsPassed = false;
 
    // 3. Chaos Fallback Test
    const chaosPassed = await runChaosTest(baseUrl);
    if (!chaosPassed) allTestsPassed = false;
 
    // 4. Saga Compensation Test
    const sagaPassed = await runSagaTest(baseUrl);
    if (!sagaPassed) allTestsPassed = false;
 
    // 5. Audit Pause Test
    const auditPassed = await runAuditTest(baseUrl);
    if (!auditPassed) allTestsPassed = false;
 
    // 6. Rate Limit Test
    const rateLimitPassed = await runRateLimitTest(baseUrl);
    if (!rateLimitPassed) allTestsPassed = false;
 
    // 7. Observability & Tracing Test
    const observabilityPassed = await runObservabilityTest(baseUrl);
    if (!observabilityPassed) allTestsPassed = false;
 
    // 8. Load Test and Latency Profiler
    const metrics = await runLoadTest(baseUrl);
    console.log(`\nThroughput: ${metrics.throughput.toFixed(2)} requests/sec`);
    console.log(`p50 Latency: ${metrics.p50} ms`);
    console.log(`p95 Latency: ${metrics.p95} ms`);
    console.log(`p99 Latency: ${metrics.p99} ms`);
 
  } catch (error) {
    console.error("Critical error during test suite execution:", error);
    allTestsPassed = false;
  } finally {
    await stopServer();
  }
 
  if (allTestsPassed) {
    console.log("\n✅ SUCCESS: ALL 8 VERIFICATION TEST PIPELINES COMPLETED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.error("\n❌ FAILURE: ONE OR MORE VERIFICATION TEST PIPELINES ENCOUNTERED MISMATCHES OR FAILURES.");
    process.exit(1);
  }
}
 
executeTestSuite();
