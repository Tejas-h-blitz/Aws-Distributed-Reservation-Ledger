import { logger } from "../src/utils/logger";

/**
 * Observability and Correlation ID Verification Test
 * Asserts that log statements across both synchronous HTTP request handlers
 * and asynchronous background Saga tasks are logged in structured JSON format
 * and carry the matching Trace ID (Correlation ID) context.
 */
export async function runObservabilityTest(baseUrl: string): Promise<boolean> {
  console.log("\n=== 8. Observability & Tracing Test ===");
  const eventId = "evt_observability_test";
  const traceId = `trace_ctx_${Math.random().toString(36).substring(2, 11)}`;

  // Seed stock level
  await fetch(`${baseUrl}/inventory/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, count: 5 }),
  });

  const capturedLogs: any[] = [];
  const logListener = (logEntry: any) => {
    capturedLogs.push(logEntry);
  };

  // Register interceptor
  logger.addListener(logListener);

  console.log(`Firing reservation request with custom X-Trace-Id: ${traceId}...`);
  const res = await fetch(`${baseUrl}/reserve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `key_obs_${traceId}`,
      "X-Trace-Id": traceId,
    },
    body: JSON.stringify({
      EventID: eventId,
      UserID: "user_observability",
    }),
  });

  if (res.status !== 202) {
    console.error(`  - Reservation failed with status: ${res.status}`);
    logger.removeListener(logListener);
    return false;
  }

  // Wait a short duration for the setImmediate thread and Saga simulator tasks to finish
  console.log("Waiting for asynchronous Saga logs to settle...");
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Remove interceptor
  logger.removeListener(logListener);

  // Filter logs carrying our trace ID
  const correlatedLogs = capturedLogs.filter((log) => log.traceId === traceId);
  console.log(`  - Intercepted ${correlatedLogs.length} logs with trace ID: ${traceId}`);

  // Assertions
  const assertLogsCaptured = correlatedLogs.length > 0;
  
  let allLogsValid = true;
  for (const log of correlatedLogs) {
    if (!log.timestamp || !log.level || log.traceId !== traceId || !log.message) {
      allLogsValid = false;
      console.error("  - Invalid log structure detected:", log);
    }
  }

  // Check trace context across the boundary (Sync API -> Async Saga)
  const hasApiLogs = correlatedLogs.some((l) => l.message.includes("reservation request") || l.message.includes("primary inventory counter"));
  const hasSagaLogs = correlatedLogs.some((l) => l.message.includes("Invoking payment") || l.message.includes("Saga execution finished"));
  
  console.log(`  - Contains Synchronous API logs: ${hasApiLogs}`);
  console.log(`  - Contains Asynchronous Saga logs: ${hasSagaLogs}`);
  console.log(`  - Valid JSON schemas: ${allLogsValid}`);

  const passed = assertLogsCaptured && allLogsValid && hasApiLogs && hasSagaLogs;
  console.log(`Outcome: ${passed ? "PASSED" : "FAILED"}`);
  return passed;
}
