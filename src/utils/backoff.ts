export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculates exponential backoff with jitter:
 * sleep = random(0, min(cap, base * 2^attempt))
 */
export function calculateBackoff(attempt: number, base = 100, cap = 5000): number {
  const maxBackoff = Math.min(cap, base * Math.pow(2, attempt));
  // random(0, maxBackoff)
  return Math.floor(Math.random() * maxBackoff);
}

/**
 * Executes a function with exponential backoff and jitter retry logic.
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  base = 100,
  cap = 5000,
  onRetry?: (error: any, attempt: number, delay: number) => void
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt >= maxAttempts) {
        throw error;
      }
      const delay = calculateBackoff(attempt, base, cap);
      if (onRetry) {
        onRetry(error, attempt, delay);
      }
      await sleep(delay);
    }
  }
}
