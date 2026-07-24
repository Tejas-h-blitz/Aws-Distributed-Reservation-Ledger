export interface TokenBucket {
  tokens: number;
  lastRefill: number; // timestamp in ms
}

export class TokenBucketRateLimiter {
  private buckets = new Map<string, TokenBucket>();

  constructor(
    private maxTokens: number,         // Maximum bucket capacity
    private refillRatePerSec: number   // Tokens added per second
  ) {}

  /**
   * Attempts to consume 1 token for a given client identifier.
   * Returns details about success, remaining tokens, and time to wait before next token.
   */
  public tryConsume(clientId: string): {
    success: boolean;
    tokensRemaining: number;
    retryAfterSeconds: number;
  } {
    const now = Date.now();
    let bucket = this.buckets.get(clientId);

    if (!bucket) {
      bucket = {
        tokens: this.maxTokens,
        lastRefill: now,
      };
      this.buckets.set(clientId, bucket);
    } else {
      // Calculate token replenishment based on elapsed time
      const elapsedMs = now - bucket.lastRefill;
      const tokensToAdd = (elapsedMs * this.refillRatePerSec) / 1000;
      
      if (tokensToAdd >= 1) {
        bucket.tokens = Math.min(this.maxTokens, bucket.tokens + Math.floor(tokensToAdd));
        // Reset refill tracker to align with full token replenishment steps
        const msPerToken = 1000 / this.refillRatePerSec;
        bucket.lastRefill = now - (elapsedMs % msPerToken);
      }
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return {
        success: true,
        tokensRemaining: Math.floor(bucket.tokens),
        retryAfterSeconds: 0,
      };
    } else {
      // Calculate how long before at least 1 token is refilled
      const msPerToken = 1000 / this.refillRatePerSec;
      const elapsedSinceRefill = now - bucket.lastRefill;
      const waitMs = Math.max(0, msPerToken - elapsedSinceRefill);
      const retryAfterSeconds = Math.ceil(waitMs / 1000);

      return {
        success: false,
        tokensRemaining: 0,
        retryAfterSeconds: retryAfterSeconds || 1, // Minimum 1 second
      };
    }
  }

  /**
   * Admin method to reset or override client buckets during testing.
   */
  public reset(clientId: string) {
    this.buckets.delete(clientId);
  }
}
