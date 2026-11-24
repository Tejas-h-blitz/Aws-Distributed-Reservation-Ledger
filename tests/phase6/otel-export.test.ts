import { strict as assert } from "node:assert";

process.env.OTEL_CONSOLE_EXPORTER = "true";
const { Observability } = require("../../src/utils/observability") as typeof import("../../src/utils/observability");

async function run(): Promise<void> {
  const observability = new Observability();
  const consoleOutput: unknown[] = [];
  const originalDir = console.dir;
  console.dir = (data?: unknown) => {
    consoleOutput.push(data);
  };

  try {
    observability.recordRequest(12, false, "reserve");
    const reserve = observability.startSpan("reserve", "otel-test-correlation");
    const saga = observability.startSpan(
      "saga",
      "otel-test-correlation",
      {},
      reserve
    );
    observability.finishSpan(saga, "OK");
    observability.finishSpan(reserve, "OK");
    await observability.forceFlush();

    const exportedSpans = consoleOutput.filter(
      (item): item is {
        name: string;
        traceId: string;
        id: string;
        attributes: Record<string, unknown>;
        parentSpanContext?: { spanId: string };
      } => typeof item === "object" && item !== null && "name" in item
    );
    const exportedReserve = exportedSpans.find(item => item.name === "reserve");
    const exportedSaga = exportedSpans.find(item => item.name === "saga");
    assert.ok(exportedReserve);
    assert.ok(exportedSaga);
    assert.equal(exportedSaga.traceId, exportedReserve.traceId);
    assert.equal(exportedSaga.parentSpanContext?.spanId, exportedReserve.id);
    assert.equal(
      exportedReserve.attributes["eddrle.correlation_id"],
      "otel-test-correlation"
    );
    assert.ok(consoleOutput.some(
      item => typeof item === "object"
        && item !== null
        && "descriptor" in item
        && (item as { descriptor: { name?: string } }).descriptor.name === "eddrle.reservation.requests"
    ));
  } finally {
    console.dir = originalDir;
  }

  console.log("Phase 6 OpenTelemetry export test PASSED.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
