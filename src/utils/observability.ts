import {
  Context,
  context,
  Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  ConsoleSpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";

export interface RedMetricSnapshot {
  requests: number;
  errors: number;
  durationCount: number;
  durationTotalMs: number;
  durationP50Ms: number;
  durationP95Ms: number;
  durationP99Ms: number;
}

export interface TraceSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  correlationId: string;
  startMs: number;
  durationMs: number;
  status: "OK" | "ERROR";
  attributes: Record<string, string | number | boolean>;
  otelSpan: Span;
  otelContext: Context;
}

const consoleExporterEnabled = process.env.OTEL_CONSOLE_EXPORTER === "true";
const tracerProvider = new NodeTracerProvider({
  spanProcessors: consoleExporterEnabled
    ? [new SimpleSpanProcessor(new ConsoleSpanExporter())]
    : [],
});
tracerProvider.register({
  contextManager: new AsyncLocalStorageContextManager(),
});

const metricReader = consoleExporterEnabled
  ? new PeriodicExportingMetricReader({
      exporter: new ConsoleMetricExporter(),
      exportIntervalMillis: 60000,
    })
  : undefined;
const meterProvider = new MeterProvider({
  readers: metricReader ? [metricReader] : [],
});
const meter = meterProvider.getMeter("ed-drle");
const requestCounter = meter.createCounter("eddrle.reservation.requests");
const errorCounter = meter.createCounter("eddrle.reservation.errors");
const durationHistogram = meter.createHistogram("eddrle.reservation.duration", {
  unit: "ms",
});
const tracer = trace.getTracer("ed-drle");
const MAX_RETAINED_SAMPLES = 2048;
type FinishedTraceSpan = Omit<TraceSpan, "otelSpan" | "otelContext">;

export class Observability {
  private readonly metrics = new Map<string, {
    requests: number;
    errors: number;
    durations: number[];
  }>();
  private readonly traceSpans: FinishedTraceSpan[] = [];

  recordRequest(durationMs: number, error: boolean, operation: string): void {
    const metric = this.metrics.get(operation) ?? {
      requests: 0,
      errors: 0,
      durations: [],
    };
    metric.requests++;
    if (error) metric.errors++;
    metric.durations.push(durationMs);
    if (metric.durations.length > MAX_RETAINED_SAMPLES) metric.durations.shift();
    this.metrics.set(operation, metric);

    requestCounter.add(1, { operation });
    if (error) errorCounter.add(1, { operation });
    durationHistogram.record(durationMs, { operation });
  }

  startSpan(
    name: string,
    correlationId: string,
    attributes: Record<string, string | number | boolean> = {},
    parent?: TraceSpan
  ): TraceSpan {
    const parentContext = parent
      ? trace.setSpan(parent.otelContext, parent.otelSpan)
      : context.active();
    const otelSpan = tracer.startSpan(
      name,
      {
        attributes: {
          ...attributes,
          "eddrle.correlation_id": correlationId,
        },
      },
      parentContext
    );
    const spanContext = otelSpan.spanContext();
    const parentSpanId = trace.getSpan(parentContext)?.spanContext().spanId ?? null;

    return {
      name,
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      parentSpanId,
      correlationId,
      startMs: Date.now(),
      durationMs: 0,
      status: "OK",
      attributes: { ...attributes, "eddrle.correlation_id": correlationId },
      otelSpan,
      otelContext: trace.setSpan(parentContext, otelSpan),
    };
  }

  withSpan<T>(span: TraceSpan, callback: () => T): T {
    return context.with(span.otelContext, callback);
  }

  async runSpan<T>(
    name: string,
    correlationId: string,
    attributes: Record<string, string | number | boolean>,
    parent: TraceSpan,
    callback: () => Promise<T>,
    isError: (result: T) => boolean = () => false
  ): Promise<T> {
    const span = this.startSpan(name, correlationId, attributes, parent);
    let result: T;
    try {
      result = await this.withSpan(span, callback);
    } catch (error) {
      this.finishSpan(span, "ERROR");
      throw error;
    }
    this.finishSpan(span, isError(result) ? "ERROR" : "OK");
    return result;
  }

  finishSpan(
    span: TraceSpan,
    status: "OK" | "ERROR",
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    for (const [key, value] of Object.entries(attributes)) {
      span.otelSpan.setAttribute(key, value);
    }
    span.otelSpan.setStatus({
      code: status === "OK" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    });
    span.otelSpan.end();

    const { otelSpan: _otelSpan, otelContext: _otelContext, ...finishedSpan } = span;
    this.traceSpans.push({
      ...finishedSpan,
      durationMs: Date.now() - span.startMs,
      status,
      attributes: { ...span.attributes, ...attributes },
    });
    if (this.traceSpans.length > MAX_RETAINED_SAMPLES) this.traceSpans.shift();
  }

  snapshot(operation: string): RedMetricSnapshot {
    const metric = this.metrics.get(operation);
    if (!metric) {
      return {
        requests: 0,
        errors: 0,
        durationCount: 0,
        durationTotalMs: 0,
        durationP50Ms: 0,
        durationP95Ms: 0,
        durationP99Ms: 0,
      };
    }
    const sorted = [...metric.durations].sort((a, b) => a - b);
    const percentile = (fraction: number) =>
      sorted[Math.floor(sorted.length * fraction)] || 0;
    return {
      requests: metric.requests,
      errors: metric.errors,
      durationCount: sorted.length,
      durationTotalMs: sorted.reduce((sum, duration) => sum + duration, 0),
      durationP50Ms: percentile(0.5),
      durationP95Ms: percentile(0.95),
      durationP99Ms: percentile(0.99),
    };
  }

  spans(): readonly FinishedTraceSpan[] {
    return [...this.traceSpans];
  }

  async forceFlush(): Promise<void> {
    await Promise.all([tracerProvider.forceFlush(), meterProvider.forceFlush()]);
  }
}

export const observability = new Observability();
