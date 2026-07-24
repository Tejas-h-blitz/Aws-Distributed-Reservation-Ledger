"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const local_server_1 = require("../src/local/local-server");
const concurrency_test_1 = require("./concurrency.test");
const idempotency_test_1 = require("./idempotency.test");
const chaos_test_1 = require("./chaos.test");
const saga_test_1 = require("./saga.test");
const audit_test_1 = require("./audit.test");
const load_test_1 = require("./load.test");
// Enable testing mode in the Service locator registry
process.env.LOCAL_TESTING = "true";
process.env.PORT = "3000";
const baseUrl = "http://localhost:3000";
let serverInstance;
async function startServer() {
    return new Promise((resolve) => {
        serverInstance = local_server_1.app.listen(3000, () => {
            console.log("Local emulated API Gateway server running on port 3000...");
            resolve();
        });
    });
}
async function stopServer() {
    return new Promise((resolve) => {
        if (serverInstance) {
            serverInstance.close(() => {
                console.log("Local emulated API Gateway server stopped.");
                resolve();
            });
        }
        else {
            resolve();
        }
    });
}
async function executeTestSuite() {
    await startServer();
    let allTestsPassed = true;
    try {
        // 1. Concurrency Test
        const concurrencyPassed = await (0, concurrency_test_1.runConcurrencyTest)(baseUrl);
        if (!concurrencyPassed)
            allTestsPassed = false;
        // 2. Idempotency Test
        const idempotencyPassed = await (0, idempotency_test_1.runIdempotencyTest)(baseUrl);
        if (!idempotencyPassed)
            allTestsPassed = false;
        // 3. Chaos Fallback Test
        const chaosPassed = await (0, chaos_test_1.runChaosTest)(baseUrl);
        if (!chaosPassed)
            allTestsPassed = false;
        // 4. Saga Compensation Test
        const sagaPassed = await (0, saga_test_1.runSagaTest)(baseUrl);
        if (!sagaPassed)
            allTestsPassed = false;
        // 5. Audit Pause Test
        const auditPassed = await (0, audit_test_1.runAuditTest)(baseUrl);
        if (!auditPassed)
            allTestsPassed = false;
        // 6. Load Test and Latency Profiler
        const metrics = await (0, load_test_1.runLoadTest)(baseUrl);
        console.log(`\nThroughput: ${metrics.throughput.toFixed(2)} requests/sec`);
        console.log(`p50 Latency: ${metrics.p50} ms`);
        console.log(`p95 Latency: ${metrics.p95} ms`);
        console.log(`p99 Latency: ${metrics.p99} ms`);
    }
    catch (error) {
        console.error("Critical error during test suite execution:", error);
        allTestsPassed = false;
    }
    finally {
        await stopServer();
    }
    if (allTestsPassed) {
        console.log("\n✅ SUCCESS: ALL 6 VERIFICATION TEST PIPELINES COMPLETED SUCCESSFULLY!");
        process.exit(0);
    }
    else {
        console.error("\n❌ FAILURE: ONE OR MORE VERIFICATION TEST PIPELINES ENCOUNTERED MISMISMATECHES OR FAILURES.");
        process.exit(1);
    }
}
executeTestSuite();
