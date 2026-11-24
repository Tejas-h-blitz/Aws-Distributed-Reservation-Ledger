import { strict as assert } from "node:assert";
import { Observability } from "../../src/utils/observability";

async function run(): Promise<void> {
  const observability = new Observability();
  for (let index = 0; index < 20; index++) {
    observability.recordRequest(index + 1, index === 19, "reserve");
  }
  const span = observability.startSpan("reserve", "trace-phase6", {
    reservationId: "hold-phase6",
  });
  const child = observability.startSpan(
    "saga",
    "trace-phase6",
    { reservationId: "hold-phase6" },
    span
  );
  observability.finishSpan(child, "OK");
  observability.finishSpan(span, "OK");

  const red = observability.snapshot("reserve");
  assert.equal(red.requests, 20);
  assert.equal(red.errors, 1);
  assert.equal(red.durationCount, 20);
  assert.ok(red.durationP95Ms >= red.durationP50Ms);

  const trace = observability.spans().find(
    item => item.name === "reserve" && item.correlationId === "trace-phase6"
  );
  assert.ok(trace);
  assert.match(trace!.traceId, /^[0-9a-f]{32}$/);
  assert.equal(trace?.status, "OK");
  const saga = observability.spans().find(item => item.name === "saga");
  assert.equal(saga?.traceId, trace?.traceId);
  assert.equal(saga?.parentSpanId, trace?.spanId);

  const boundedObservability = new Observability();
  for (let index = 0; index < 2050; index++) {
    boundedObservability.recordRequest(index, false, "reserve");
  }
  const bounded = boundedObservability.snapshot("reserve");
  assert.equal(bounded.requests, 2050);
  assert.equal(bounded.durationCount, 2048);
  for (let index = 0; index < 2050; index++) {
    const retainedSpan = boundedObservability.startSpan("sample", "bounded-test");
    boundedObservability.finishSpan(retainedSpan, "OK");
  }
  assert.equal(boundedObservability.spans().length, 2048);

  console.log("Phase 6 RED/span observability test PASSED.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
