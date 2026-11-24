import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AddressInfo } from "node:net";
import { Server } from "node:http";

const eventId = "hot-key-benchmark";
const requestCount = 500;
const batchSize = 50;

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.floor(sorted.length * fraction)] || 0;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function run(): Promise<void> {
  process.env.LOCAL_TESTING = "true";
  process.env.PORT = "0";
  const { app } = require("../src/local/local-server") as {
    app: import("express").Express;
  };
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await fetch(`${baseUrl}/inventory/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, count: 500 }),
    });

    const latencies: number[] = [];
    let successCount = 0;
    let errorCount = 0;
    const statusCounts: Record<string, number> = {};
    const start = Date.now();

    for (let offset = 0; offset < requestCount; offset += batchSize) {
      const batch = [];
      for (let index = offset; index < Math.min(offset + batchSize, requestCount); index++) {
        const requestStart = Date.now();
        batch.push((async () => {
          try {
            const response = await fetch(`${baseUrl}/reserve`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": `hot-key-${index}`,
              },
              body: JSON.stringify({
                EventID: eventId,
                UserID: `hot-user-${index}`,
                HoldID: `hot-hold-${index}`,
              }),
            });
            latencies.push(Date.now() - requestStart);
            const status = String(response.status);
            statusCounts[status] = (statusCounts[status] || 0) + 1;
            if (response.status === 202) successCount++;
            else errorCount++;
            await response.arrayBuffer();
          } catch (error) {
            latencies.push(Date.now() - requestStart);
            errorCount++;
          }
        })());
      }
      await Promise.all(batch);
    }

    const durationMs = Date.now() - start;
    const sorted = [...latencies].sort((a, b) => a - b);
    const repoRoot = path.resolve(__dirname, "..");
    const recordedAt = new Date().toISOString();
    const result = {
      label: "local-in-memory",
      recordedAt,
      gitCommit: execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      environment: {
        platform: os.platform(),
        release: os.release(),
        architecture: os.arch(),
        nodeVersion: process.version,
        cpuModel: os.cpus()[0]?.model || "unknown",
        logicalCpuCount: os.cpus().length,
      },
      scenario: {
        description: "500 reservations against one event hot key",
        localRateLimitBehavior: "bypassed (no client ID)",
        storage: "in-memory repositories",
      },
      sample: {
        requestCount,
        batchSize,
        durationMs,
        throughputRps: requestCount / (durationMs / 1000),
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        p99Ms: percentile(sorted, 0.99),
        successCount,
        errorCount,
        statusCounts,
        latenciesMs: sorted,
      },
    };
    const resultsDir = path.join(__dirname, "results");
    mkdirSync(resultsDir, { recursive: true });
    const filename = `hot-key-${recordedAt.replace(/[:.]/g, "-")}.json`;
    const resultPath = path.join(resultsDir, filename);
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeServer(server);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
