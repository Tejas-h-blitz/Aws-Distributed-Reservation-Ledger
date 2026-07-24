"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const registry_1 = require("../registry");
const idempotency_1 = require("../utils/idempotency");
const uuid_1 = require("uuid");
/**
 * AWS Lambda handler for /reserve POST endpoint.
 */
async function handler(event) {
    const registry = (0, registry_1.getRegistry)();
    const idempotencyService = new idempotency_1.IdempotencyService(registry.idempotency);
    const headers = event.headers || {};
    // Resolve Idempotency-Key case-insensitively
    const idempotencyKey = headers["idempotency-key"] || headers["Idempotency-Key"] || "";
    if (!idempotencyKey) {
        return {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Missing 'Idempotency-Key' header." }),
        };
    }
    try {
        const result = await idempotencyService.getOrExecute(idempotencyKey, async () => {
            let body = {};
            try {
                body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
            }
            catch {
                return {
                    statusCode: 400,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Invalid JSON body." }),
                };
            }
            const { EventID, UserID, HoldID } = body;
            if (!EventID || !UserID) {
                return {
                    statusCode: 400,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Missing required attributes 'EventID' or 'UserID' in request body." }),
                };
            }
            const targetHoldId = HoldID || (0, uuid_1.v4)();
            const expirationSeconds = Math.floor(Date.now() / 1000) + 600; // 10 minutes TTL
            let decrementSucceeded = false;
            let usedFallback = false;
            // 1. Attempt decrement on primary inventory counter (Redis)
            try {
                decrementSucceeded = await registry.inventory.decrementStock(EventID);
            }
            catch (redisError) {
                console.warn(`Primary inventory store failed. Falling back to DynamoDB. Error: ${redisError.message}`);
                // 2. Fallback to DynamoDB counter
                try {
                    decrementSucceeded = await registry.fallbackInventory.decrementStock(EventID);
                    usedFallback = true;
                }
                catch (dynamoError) {
                    console.error(`Fallback inventory store failed. Outage confirmed. Error: ${dynamoError.message}`);
                    return {
                        statusCode: 500,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ error: "Inventory database services are temporarily offline." }),
                    };
                }
            }
            if (!decrementSucceeded) {
                return {
                    statusCode: 409,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Inventory is out of stock." }),
                };
            }
            // 3. Write active hold record to DynamoDB (conditional write attribute_not_exists(HoldID))
            try {
                await registry.holds.createHold({
                    HoldID: targetHoldId,
                    EventID,
                    UserID,
                    ExpirationTimestamp: expirationSeconds,
                    Status: "PENDING",
                });
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
            }
            catch (holdError) {
                console.error(`Failed to create hold record. Initiating counter compensation. Error: ${holdError.message}`);
                // 4. Compensation: Increment counter back on whichever store was decremented
                try {
                    if (usedFallback) {
                        await registry.fallbackInventory.incrementStock(EventID);
                    }
                    else {
                        await registry.inventory.incrementStock(EventID);
                    }
                }
                catch (compensationError) {
                    console.error(`CRITICAL: Failed to compensate inventory decrement for EventID ${EventID}! Data drift occurred.`, compensationError);
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
    }
    catch (err) {
        return {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: err.message }),
        };
    }
}
