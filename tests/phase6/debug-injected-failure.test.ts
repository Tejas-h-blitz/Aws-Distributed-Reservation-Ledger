import { strict as assert } from "node:assert";
import { app } from "../../src/local/local-server";

async function run(): Promise<void> {
  process.env.LOCAL_TESTING = "true";
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server address");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await fetch(`${baseUrl}/inventory/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: "phase6-debug-event", count: 1 }),
    });

    const traceId = "trace-phase6-injected-failure";
    const incomingTraceId = "11111111111111111111111111111111";
    const incomingParentSpanId = "2222222222222222";
    const reserve = await fetch(`${baseUrl}/reserve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "phase6-debug-key",
        "X-Trace-Id": traceId,
        traceparent: `00-${incomingTraceId}-${incomingParentSpanId}-01`,
      },
      body: JSON.stringify({
        EventID: "phase6-debug-event",
        UserID: "phase6-debug-user",
        HoldID: "hold_fail_phase6_debug",
      }),
    });
    assert.equal(reserve.status, 202);
    await new Promise(resolve => setTimeout(resolve, 350));

    const snapshot = await fetch(`${baseUrl}/observability`);
    assert.equal(snapshot.status, 200);
    const observed = await snapshot.json() as {
      red: { requests: number; errors: number };
      spans: Array<{
        name: string;
        traceId: string;
        correlationId: string;
        spanId: string;
        parentSpanId: string | null;
        status: "OK" | "ERROR";
      }>;
    };

    assert.equal(observed.red.requests, 1);
    assert.equal(observed.red.errors, 0);
    const sagaSpan = observed.spans.find(
      span => span.name === "saga" && span.correlationId === traceId
    );
    assert.equal(sagaSpan?.status, "ERROR");
    const reserveSpan = observed.spans.find(
      span => span.name === "reserve" && span.correlationId === traceId
    );
    assert.equal(reserveSpan?.traceId, incomingTraceId);
    assert.equal(reserveSpan?.parentSpanId, incomingParentSpanId);
    const failedPaymentSpan = observed.spans.find(
      span => span.name === "saga.payment" && span.correlationId === traceId
    );
    const compensationSpan = observed.spans.find(
      span => span.name === "saga.compensation" && span.correlationId === traceId
    );
    assert.equal(sagaSpan?.parentSpanId, reserveSpan?.spanId);
    assert.equal(failedPaymentSpan?.parentSpanId, sagaSpan?.spanId);
    assert.equal(failedPaymentSpan?.status, "ERROR");
    assert.equal(compensationSpan?.parentSpanId, sagaSpan?.spanId);
    assert.equal(compensationSpan?.status, "OK");

    console.log(
      `Injected-failure debug PASSED: reserveRed=${observed.red.requests}/${observed.red.errors}, sagaStatus=${sagaSpan?.status}`
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
