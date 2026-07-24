import { AsyncLocalStorage } from "async_hooks";

export const traceStorage = new AsyncLocalStorage<string>();

export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG"
}

type LogListener = (logEntry: any) => void;
const listeners: LogListener[] = [];

export const logger = {
  /**
   * Register a callback to intercept log entries. Useful for integration testing of observability.
   */
  addListener(listener: LogListener) {
    listeners.push(listener);
  },

  /**
   * Remove a registered log listener.
   */
  removeListener(listener: LogListener) {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) {
      listeners.splice(idx, 1);
    }
  },

  log(level: LogLevel, message: string, metadata: any = {}) {
    const traceId = traceStorage.getStore();
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      traceId: traceId || "no-trace-context",
      message,
      ...metadata
    };

    // Output JSON string to stdout (standard production configuration for CloudWatch)
    console.log(JSON.stringify(logEntry));

    // Notify listeners (for unit/integration testing assertions)
    for (const listener of listeners) {
      try {
        listener(logEntry);
      } catch (err) {
        // Suppress listener errors to avoid breaking execution
      }
    }
  },

  info(message: string, metadata?: any) {
    this.log(LogLevel.INFO, message, metadata);
  },

  warn(message: string, metadata?: any) {
    this.log(LogLevel.WARN, message, metadata);
  },

  error(message: string, error?: any, metadata?: any) {
    let errorMeta: any = {};
    if (error instanceof Error) {
      errorMeta = { error: error.message, stack: error.stack };
    } else if (error !== undefined) {
      errorMeta = { error: String(error) };
    }
    this.log(LogLevel.ERROR, message, { ...errorMeta, ...metadata });
  },

  debug(message: string, metadata?: any) {
    this.log(LogLevel.DEBUG, message, metadata);
  }
};
