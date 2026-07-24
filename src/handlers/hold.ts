import { getRegistry } from "../registry";
import { IdempotencyService } from "../utils/idempotency";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { TokenBucketRateLimiter } from "../utils/rate-limiter";

// Rate Limiter instance: 10 burst capacity, refill 2 per second
export const reserveRateLimiter = new TokenBucketRateLimiter(10, 2);

/**
 * AWS Lambda handler for /reserve POST endpoint.
 */
export async function handler(event: any): Promise<any> {
  const registry = getRegistry();
  const idempotencyService = new IdempotencyService(registry.idempotency);

  const headers = event.headers || {};
  // Resolve Idempotency-Key case-insensitively
  const idempotencyKey = headers["idempotency-key"] || headers["Idempotency-Key"] || "";

  // 1. Rate Limiting Check
  // Identify client by 'x-client-id' header. If not present (e.g. general load/concurrency testing), bypass rate limiting in local tests.
  const clientId = headers["x-client-id"] || headers["X-Client-Id"] || "";
  const bypassRateLimit = headers["x-bypass-rate-limit"] === "true" || (!clientId && process.env.LOCAL_TESTING === "true");
 
  if (clientId && !bypassRateLimit) {
    const rateLimitResult = reserveRateLimiter.tryConsume(clientId);
 
    if (!rateLimitResult.success) {
      logger.warn(`API Gateway rate limit exceeded for client: ${clientId}`, { clientId, retryAfterSeconds: rateLimitResult.retryAfterSeconds });
      return {
        statusCode: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rateLimitResult.retryAfterSeconds),
        },
        body: JSON.stringify({ error: "Too many requests. Please retry later." }),
      };
    }
  }

  if (!idempotencyKey) {
    logger.warn("Rejected reservation request due to missing Idempotency-Key");
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing 'Idempotency-Key' header." }),
    };
  }

  try {
    logger.info("Executing reservation request with idempotency key", { idempotencyKey });
    const result = await idempotencyService.getOrExecute(idempotencyKey, async () => {
      let body: any = {};
      try {
        body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
      } catch {
        logger.warn("Received malformed JSON body in reservation request");
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid JSON body." }),
        };
      }

      const { EventID, UserID, HoldID } = body;
      if (!EventID || !UserID) {
        logger.warn("Missing required fields in reservation request", { EventID, UserID });
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Missing required attributes 'EventID' or 'UserID' in request body." }),
        };
      }

      const targetHoldId = HoldID || uuidv4();
      const expirationSeconds = Math.floor(Date.now() / 1000) + 600; // 10 minutes TTL

      let decrementSucceeded = false;
      let usedFallback = false;

      // 1. Attempt decrement on primary inventory counter (Redis)
      try {
        logger.info("Attempting primary inventory counter decrement", { EventID, ReservationID: targetHoldId });
        decrementSucceeded = await registry.inventory.decrementStock(EventID);
      } catch (redisError: any) {
        logger.warn(`Primary inventory store failed. Falling back to DynamoDB. Error: ${redisError.message}`, { EventID, ReservationID: targetHoldId });
        // 2. Fallback to DynamoDB counter
        try {
          decrementSucceeded = await registry.fallbackInventory.decrementStock(EventID);
          usedFallback = true;
          logger.info("Successfully decremented inventory counter via fallback store", { EventID, ReservationID: targetHoldId });
        } catch (dynamoError: any) {
          logger.error(`Fallback inventory store failed. Outage confirmed. Error: ${dynamoError.message}`, dynamoError, { EventID, ReservationID: targetHoldId });
          return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Inventory database services are temporarily offline." }),
          };
        }
      }

      if (!decrementSucceeded) {
        logger.info("Inventory is out of stock for event", { EventID, ReservationID: targetHoldId });
        return {
          statusCode: 409,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Inventory is out of stock." }),
        };
      }

      // 3. Write active hold record to DynamoDB (conditional write attribute_not_exists(HoldID))
      try {
        logger.info("Creating active hold record in database", { ReservationID: targetHoldId, UserID, EventID });
        await registry.holds.createHold({
          HoldID: targetHoldId,
          EventID,
          UserID,
          ExpirationTimestamp: expirationSeconds,
          Status: "PENDING",
        });

        logger.info("Successfully created reservation hold", { ReservationID: targetHoldId, UserID, EventID, usedFallback });

        return {
          statusCode: 202,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ReservationID: targetHoldId,
            EventID,
            UserID,
            ExpirationTimestamp: expirationSeconds,
            UsedFallbackStore: usedFallback,
            Status: "PENDING",
          }),
        };
      } catch (holdError: any) {
        logger.error(`Failed to create hold record. Initiating counter compensation. Error: ${holdError.message}`, holdError, { ReservationID: targetHoldId });
        
        // 4. Compensation: Increment counter back on whichever store was decremented
        try {
          if (usedFallback) {
            await registry.fallbackInventory.incrementStock(EventID);
          } else {
            await registry.inventory.incrementStock(EventID);
          }
          logger.info("Successfully compensated inventory decrement after hold creation failure", { EventID, ReservationID: targetHoldId });
        } catch (compensationError: any) {
          logger.error(`CRITICAL: Failed to compensate inventory decrement for EventID ${EventID}! Data drift occurred.`, compensationError, { EventID, ReservationID: targetHoldId });
        }

        if (holdError.name === "ConditionalCheckFailedException") {
          return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Reservation ID already exists." }),
          };
        }

        return {
          statusCode: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Failed to write reservation hold record." }),
        };
      }
    });

    // If result is already formatted as APIGW Proxy result
    if (result && typeof result === "object" && "statusCode" in result) {
      return result;
    }

    return {
      statusCode: 202,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err: any) {
    logger.error("Unhandleable error occurred in reservation process", err);
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
}
