# Phase 6 Observability

## RED metrics

`GET /observability` returns a snapshot for the `/reserve` operation:

- `requests`: accepted HTTP-handler executions
- `errors`: HTTP 5xx responses
- `durationCount`, `durationTotalMs`
- p50, p95, p99 duration values

The local implementation records one metric per reservation-handler call.
Saga durations and statuses are trace spans rather than HTTP RED metrics.

## Correlation and spans

The existing `AsyncLocalStorage` correlation ID remains available to structured
logs and is also recorded as `eddrle.correlation_id`. OpenTelemetry uses its
own W3C trace ID and span IDs; incoming `traceparent` headers are extracted by
the local HTTP middleware.

The local server creates a `reserve` span. The saga simulator creates child
spans for the saga, each payment attempt, ledger write, and compensation. The
`AsyncLocalStorageContextManager` preserves the active span across async work.
`GET /observability` returns local RED snapshots and a bounded projection of
finished spans, and flushes telemetry before responding.

Finished span snapshots and duration samples are capped at 2,048 entries per
process. Request and error counts remain cumulative; duration totals, sample
counts, and percentiles describe the retained recent window.

## Dashboard and alerts

The CDK stack already has CloudWatch dashboard and alarm definitions for hold
Lambda errors, failed sagas, and DLQ depth. Phase 6 has not added custom RED
metrics or a live dashboard/alert delivery test.

## OpenTelemetry status

The approved OpenTelemetry API, Node SDK, async context manager, and metrics
SDK are installed. Counters and a duration histogram are exported alongside
the spans when `OTEL_CONSOLE_EXPORTER=true`; otherwise the SDK records spans
and metrics locally without a console exporter. The default exporter is
disabled to avoid writing every span to stdout during ordinary local runs.

## Debug workflow

1. Reproduce a forced saga failure using a hold ID containing `fail`.
2. Send an `X-Trace-Id` correlation value and, optionally, a W3C `traceparent`.
3. Query `GET /observability`.
4. Confirm the reserve, saga, payment, and compensation spans share a trace,
   have the expected parent IDs, and show the injected payment failure.
5. To verify exporter delivery locally, run `npm run test:otel`; its test
   captures console-exported spans and metrics and verifies parent linkage.

## Limits

- The console exporter is diagnostic output, not an OTLP collector or a
  production exporter. No export to a remote collector has been tested.
- No live CloudWatch dashboard or alert delivery test.
- No AWS trace/metric export or multi-instance propagation test.
- Sampling and baggage policies are not configured.
