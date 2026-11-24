import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { Server } from "node:http";

const requestCount = 500;
const batchSize = 50;

interface Sample {
  requestCount: number;
  batchSize: number;
  durationMs: number;
  throughputRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  successCount: number;
  errorCount: number;
  statusCounts: Record<string, number>;
  latenciesMs: number[];
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.floor(sorted.length * fraction)] || 0;
}

function currentCommit(repoRoot: string): string {
  return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
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
    const eventId = `evt_v1_bench_${Date.now()}`;
    const seedResponse = await fetch(`${baseUrl}/inventory/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, count: 1000 }),
    });
    if (!seedResponse.ok) {
      throw new Error(`Inventory seed failed with HTTP ${seedResponse.status}`);
    }

    const latenciesMs: number[] = [];
    const statusCounts: Record<string, number> = {};
    let successCount = 0;
    let errorCount = 0;
    const startTime = Date.now();

    for (let offset = 0; offset < requestCount; offset += batchSize) {
      const batch = [];
      for (let index = offset; index < Math.min(offset + batchSize, requestCount); index++) {
        const requestStart = Date.now();
        batch.push((async () => {
          let receivedResponse = false;
          try {
            const response = await fetch(`${baseUrl}/reserve`, {
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
            });
            receivedResponse = true;
            latenciesMs.push(Date.now() - requestStart);
            const status = String(response.status);
            statusCounts[status] = (statusCounts[status] || 0) + 1;
            if (response.status === 202) {
              successCount++;
            } else {
              errorCount++;
            }
            await response.arrayBuffer();
          } catch (error) {
            if (!receivedResponse) {
              latenciesMs.push(Date.now() - requestStart);
            }
            errorCount++;
            console.error(`Request ${index} failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        })());
      }
      await Promise.all(batch);
    }

    const durationMs = Date.now() - startTime;
    const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
    const sample: Sample = {
      requestCount,
      batchSize,
      durationMs,
      throughputRps: durationMs === 0 ? 0 : requestCount / (durationMs / 1000),
      p50Ms: percentile(sortedLatencies, 0.5),
      p95Ms: percentile(sortedLatencies, 0.95),
      p99Ms: percentile(sortedLatencies, 0.99),
      successCount,
      errorCount,
      statusCounts,
      latenciesMs: sortedLatencies,
    };

    const repoRoot = path.resolve(__dirname, "..");
    const recordedAt = new Date().toISOString();
    const result = {
      label: "local-in-memory",
      recordedAt,
      gitCommit: currentCommit(repoRoot),
      environment: {
        platform: os.platform(),
        release: os.release(),
        architecture: os.arch(),
        nodeVersion: process.version,
        cpuModel: os.cpus()[0]?.model || "unknown",
        logicalCpuCount: os.cpus().length,
      },
      scenario: {
        description: "v1 load test: 500 reserve requests in sequential batches of 50",
        localRateLimitBehavior: "bypassed as in tests/load.test.ts (no client ID)",
        storage: "in-memory repositories selected by LOCAL_TESTING=true",
      },
      sample,
    };
    const resultsDir = path.join(__dirname, "results");
    mkdirSync(resultsDir, { recursive: true });
    const filename = `v1-load-${recordedAt.replace(/[:.]/g, "-")}.json`;
    const resultPath = path.join(resultsDir, filename);
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result, null, 2));
    console.log(`Raw result saved to ${path.relative(repoRoot, resultPath)}`);
  } finally {
    await closeServer(server);
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
