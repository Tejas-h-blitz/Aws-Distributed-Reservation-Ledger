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
  startMs: number;
  durationMs: number;
  status: "OK" | "ERROR";
  attributes: Record<string, string | number | boolean>;
}

export class Observability {
  private readonly metrics = new Map<string, {
    requests: number;
    errors: number;
    durations: number[];
  }>();
  private readonly traceSpans: TraceSpan[] = [];

  constructor() {}

  recordRequest(durationMs: number, error: boolean, operation: string): void {
    const metric = this.metrics.get(operation) ?? {
      requests: 0,
      errors: 0,
      durations: [],
    };
    metric.requests++;
    if (error) metric.errors++;
    metric.durations.push(durationMs);
    this.metrics.set(operation, metric);
  }

  startSpan(
    name: string,
    traceId: string,
    attributes: Record<string, string | number | boolean> = {}
  ): TraceSpan {
    return {
      name,
      traceId,
      startMs: Date.now(),
      durationMs: 0,
      status: "OK",
      attributes,
    };
  }

  finishSpan(
    span: TraceSpan,
    status: "OK" | "ERROR",
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    const completed: TraceSpan = {
      ...span,
      durationMs: Date.now() - span.startMs,
      status,
      attributes: { ...span.attributes, ...attributes },
    };
    this.traceSpans.push(completed);
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

  spans(): readonly TraceSpan[] {
    return [...this.traceSpans];
  }
}

export const observability = new Observability();
