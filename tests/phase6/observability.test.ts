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
  observability.finishSpan(span, "OK");

  const red = observability.snapshot("reserve");
  assert.equal(red.requests, 20);
  assert.equal(red.errors, 1);
  assert.equal(red.durationCount, 20);
  assert.ok(red.durationP95Ms >= red.durationP50Ms);

  const trace = observability.spans().find(item => item.traceId === "trace-phase6");
  assert.ok(trace);
  assert.equal(trace?.status, "OK");

  console.log("Phase 6 RED/span observability test PASSED.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
