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

The existing `AsyncLocalStorage` trace ID remains the correlation key. The
local server creates a `reserve` span and the saga simulator creates a `saga`
span using the same trace ID.

## Dashboard and alerts

The CDK stack already has CloudWatch dashboard and alarm definitions for hold
Lambda errors, failed sagas, and DLQ depth. Phase 6 has not added custom RED
metrics or a live dashboard/alert delivery test.

## Debug workflow

1. Reproduce a forced saga failure using a hold ID containing `fail`.
2. Correlate the returned trace ID with structured logs.
3. Query `GET /observability`.
4. Confirm `/reserve` HTTP RED and the associated saga span status.

## Limits

- No OTLP/OpenTelemetry dependency or remote exporter.
- No live CloudWatch dashboard or alert delivery test.
- No cross-service network trace sampling or baggage specification.
