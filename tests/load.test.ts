import * as fs from "fs";
import * as path from "path";

/**
 * Load Test & Latency Profiler
 * Fires 500 API requests, collects response times, computes p50/p95/p99,
 * and outputs results to metrics.json file.
 */
export async function runLoadTest(baseUrl: string): Promise<{
  p50: number;
  p95: number;
  p99: number;
  max: number;
  throughput: number;
  totalRequests: number;
  successRate: number;
}> {
  console.log("\n=== 6. Load Test & Latency Profiling ===");
  const eventId = "evt_load_profile_run";
  const requestCount = 500;

  // Seed stock level
  await fetch(`${baseUrl}/inventory/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, count: 1000 }),
  });

  console.log(`Driving load test of ${requestCount} requests against ${baseUrl}/reserve...`);

  const latencies: number[] = [];
  let successfulRequests = 0;
  const startTime = Date.now();

  // Run in batch slices of 50 to avoid connection pooling bottlenecks
  const batchSize = 50;
  for (let i = 0; i < requestCount; i += batchSize) {
    const batchPromises = [];
    for (let j = 0; j < batchSize && (i + j) < requestCount; j++) {
      const index = i + j;
      const start = Date.now();
      batchPromises.push(
        fetch(`${baseUrl}/reserve`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `key_load_test_user_${index}`,
          },
          body: JSON.stringify({
            EventID: eventId,
            UserID: `user_load_test_${index}`,
            HoldID: `hold_load_test_${index}`,
          }),
        }).then(async r => {
          const duration = Date.now() - start;
          latencies.push(duration);
          if (r.status === 202) {
            successfulRequests++;
          }
        }).catch(err => {
          latencies.push(Date.now() - start);
          console.error(`Request index ${index} failed:`, err.message);
        })
      );
    }
    await Promise.all(batchPromises);
  }

  const endTime = Date.now();
  const totalDurationSeconds = (endTime - startTime) / 1000;

  // Calculate statistics
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const max = latencies[latencies.length - 1] || 0;
  const throughput = requestCount / totalDurationSeconds;

  console.log("Load Test Performance Metrics:");
  console.log(`  - Total Requests: ${requestCount}`);
  console.log(`  - Successful holds: ${successfulRequests}`);
  console.log(`  - Total Duration: ${totalDurationSeconds.toFixed(2)} seconds`);
  console.log(`  - Throughput: ${throughput.toFixed(2)} RPS`);
  console.log(`  - p50 (Median) Latency: ${p50} ms`);
  console.log(`  - p95 Latency: ${p95} ms`);
  console.log(`  - p99 Latency: ${p99} ms`);
  console.log(`  - Max Latency: ${max} ms`);

  const metrics = {
    p50,
    p95,
    p99,
    max,
    throughput,
    totalRequests: requestCount,
    successRate: (successfulRequests / requestCount) * 100,
  };

  // Ensure test-results/ directory exists
  const resultsDir = path.join(__dirname, "../test-results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir);
  }
  fs.writeFileSync(
    path.join(resultsDir, "metrics.json"),
    JSON.stringify(metrics, null, 2),
    "utf8"
  );
  console.log(`Metrics successfully written to: test-results/metrics.json`);

  return metrics;
}
