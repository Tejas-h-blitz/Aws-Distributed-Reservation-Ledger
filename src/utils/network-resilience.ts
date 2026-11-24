import { calculateBackoff, sleep } from "./backoff";

export interface NetworkPolicyOptions {
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxConcurrent?: number;
  random?: () => number;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

let inFlight = 0;

export class LoadSheddingError extends Error {
  constructor() {
    super("Downstream request rejected due to backpressure.");
    this.name = "LoadSheddingError";
  }
}

export async function executeNetworkPolicy<T>(
  fn: () => Promise<T>,
  options: NetworkPolicyOptions
): Promise<T> {
  if (options.maxConcurrent !== undefined && inFlight >= options.maxConcurrent) {
    throw new LoadSheddingError();
  }

  if (options.maxConcurrent !== undefined) {
    inFlight++;
  }

  try {
    let lastError: unknown;
    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error("Downstream call timed out.")),
            options.timeoutMs
          );
        });

        try {
          return await Promise.race([fn(), timeoutPromise]);
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
      } catch (error) {
        lastError = error;
        if (attempt >= options.maxAttempts) break;

        const random = options.random ?? Math.random;
        const capped = Math.min(
          options.maxDelayMs,
          options.baseDelayMs * Math.pow(2, attempt - 1)
        );
        const delayMs = Math.floor(capped * Math.max(0, Math.min(1, random())));
        if (options.onRetry) {
          options.onRetry(error, attempt, delayMs);
        }
        await sleep(delayMs);
      }
    }
    throw lastError;
  } finally {
    if (options.maxConcurrent !== undefined) {
      inFlight--;
    }
  }
}
