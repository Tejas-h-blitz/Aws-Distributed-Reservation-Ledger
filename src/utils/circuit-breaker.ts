import { logger } from "./logger";

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN"
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private lastStateChange: number = Date.now();
  private requestHistory: { timestamp: number; success: boolean }[] = [];

  constructor(
    private failureRateThreshold = 0.5,
    private windowMs = 10000,
    private resetTimeoutMs = 5000,
    private minRequests = 4 // Minimum requests in window before evaluating
  ) {}

  public getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  private updateState() {
    const now = Date.now();
    if (this.state === CircuitState.OPEN) {
      if (now - this.lastStateChange > this.resetTimeoutMs) {
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }
  }

  private transitionTo(newState: CircuitState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    if (newState === CircuitState.CLOSED) {
      this.requestHistory = [];
    }
    logger.warn(`Circuit breaker transitioned state`, { oldState, newState });
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.updateState();

    if (this.state === CircuitState.OPEN) {
      throw new Error("CircuitBreaker is OPEN. Call blocked.");
    }

    try {
      const result = await fn();
      this.recordRequest(true);
      if (this.state === CircuitState.HALF_OPEN) {
        this.transitionTo(CircuitState.CLOSED);
      }
      return result;
    } catch (error) {
      this.recordRequest(false);
      this.evaluateFailure();
      throw error;
    }
  }

  private recordRequest(success: boolean) {
    const now = Date.now();
    this.requestHistory.push({ timestamp: now, success });
    this.cleanHistory(now);
  }

  private cleanHistory(now: number) {
    this.requestHistory = this.requestHistory.filter(
      r => now - r.timestamp <= this.windowMs
    );
  }

  private evaluateFailure() {
    const now = Date.now();
    this.cleanHistory(now);

    if (this.state === CircuitState.CLOSED) {
      if (this.requestHistory.length >= this.minRequests) {
        const failures = this.requestHistory.filter(r => !r.success).length;
        const failureRate = failures / this.requestHistory.length;
        if (failureRate > this.failureRateThreshold) {
          this.transitionTo(CircuitState.OPEN);
        }
      }
    } else if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in HALF_OPEN trips it back to OPEN immediately
      this.transitionTo(CircuitState.OPEN);
    }
  }

  // Force state change (useful for testing)
  public forceOpen() {
    this.transitionTo(CircuitState.OPEN);
  }
}
