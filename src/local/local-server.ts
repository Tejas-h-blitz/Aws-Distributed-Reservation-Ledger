import express from "express";
import { handler as holdHandler } from "../handlers/hold";
import { StepFunctionsSimulator } from "./sfn-simulator";
import { getRegistry } from "../registry";
import { MemoryInventoryRepository } from "../repository/inventory.memory";
import { pendingHumanReviews } from "../handlers/audit-reconciler";
import { traceStorage, logger } from "../utils/logger";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

// Express middleware to bind every incoming API request to a unique trace context (Correlation ID)
app.use((req, res, next) => {
  const traceId = (req.headers["x-trace-id"] || req.headers["x-amzn-trace-id"] || uuidv4()) as string;
  traceStorage.run(traceId, () => {
    next();
  });
});

const PORT = process.env.PORT || 3000;

// Track if Redis is simulated offline
let redisOffline = false;

/**
 * 1. Synchronous API Gateway /reserve Endpoint
 */
app.post("/reserve", async (req, res) => {
  // Format Express request to Lambda event structure
  const event = {
    headers: req.headers,
    body: JSON.stringify(req.body),
  };

  const response = await holdHandler(event);

  // Set headers
  if (response.headers) {
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value as string);
    }
  }

  res.status(response.statusCode).send(response.body);

  // 2. Event-Driven Saga Simulation (Asynchronous Path)
  // If the reservation hold was accepted (HTTP 202), trigger the Step Functions saga in the background
  if (response.statusCode === 202) {
    const holdData = JSON.parse(response.body);
    const traceId = traceStorage.getStore() || uuidv4();
    
    // Launch background Saga (Non-blocking), maintaining the trace ID across the event boundary
    setImmediate(async () => {
      await traceStorage.run(traceId, async () => {
        logger.info(`[EventBridge] Forwarding HoldCreated event to Step Functions`, { ReservationID: holdData.ReservationID });
        
        const sagaResult = await StepFunctionsSimulator.executeSagaWorkflow({
          ReservationID: holdData.ReservationID,
          EventID: holdData.EventID,
          UserID: holdData.UserID,
          Amount: 125.50, // standard seat amount
          Currency: "USD",
          UsedFallbackStore: holdData.UsedFallbackStore || false,
        });

        logger.info(`[StepFunctions] Saga execution finished`, { ReservationID: holdData.ReservationID, status: sagaResult.status, history: sagaResult.history });
      });
    });
  }
});

/**
 * 3. Mock S3 Ingestion Upload Endpoint
 * Simulates uploading third-party settlement files to S3 bucket.
 */
app.post("/audit/upload", async (req, res) => {
  const settlements = req.body;
  if (!Array.isArray(settlements)) {
    return res.status(400).json({ error: "Expected JSON array of settlement records." });
  }

  logger.info(`[S3] Settlement file landed in bucket`, { recordCount: settlements.length });
  
  const results = [];
  for (const record of settlements) {
    // Each settlement audit execution receives its own trace ID if not already provided
    const traceId = (req.headers["x-trace-id"] || req.headers["x-amzn-trace-id"] || uuidv4()) as string;
    const auditRes = await traceStorage.run(traceId, async () => {
      return await StepFunctionsSimulator.executeAuditWorkflow(record);
    });
    results.push({
      reservationId: record.reservationId,
      status: auditRes.status,
      explanation: auditRes.explanation,
    });
  }

  res.status(200).json({ message: "Audit processing initiated.", results });
});

/**
 * 4. List pending audit review requests
 */
app.get("/audit/pending", (req, res) => {
  const reviews = Array.from(pendingHumanReviews.entries()).map(([reviewId, data]) => ({
    reviewId,
    explanation: data.explanation,
    settlementRecord: data.settlementRecord,
  }));
  res.status(200).json(reviews);
});

/**
 * 5. Approve pending audit discrepancy
 */
app.post("/audit/approve", async (req, res) => {
  const { reviewId, ledgerReservationId } = req.body;
  if (!reviewId) {
    return res.status(400).json({ error: "Missing required parameter 'reviewId'." });
  }

  try {
    const success = await StepFunctionsSimulator.approveAudit(reviewId, ledgerReservationId);
    return res.status(200).json({ success, message: `Review ${reviewId} approved, transaction status reconciled.` });
  } catch (error: any) {
    return res.status(404).json({ error: error.message });
  }
});

/**
 * 6. Get live stock metrics
 */
app.get("/inventory/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const registry = getRegistry();

  let redisStock = -1;
  try {
    redisStock = await registry.inventory.getCurrentStock(eventId);
  } catch (err: any) {
    redisStock = -999; // Represents connection error
  }

  const dynamoStock = await registry.fallbackInventory.getCurrentStock(eventId);

  res.status(200).json({
    EventID: eventId,
    RedisStock: redisStock === -999 ? "OFFLINE/UNREACHABLE" : redisStock,
    DynamoDBStock: dynamoStock,
  });
});

/**
 * 7. Seed inventory stock levels
 */
app.post("/inventory/seed", async (req, res) => {
  const { eventId, count } = req.body;
  if (!eventId || count === undefined) {
    return res.status(400).json({ error: "Missing parameters 'eventId' or 'count'." });
  }

  const registry = getRegistry();
  
  try {
    await registry.inventory.setStock(eventId, count);
  } catch {
    console.warn("Unable to seed Redis counter (unreachable).");
  }

  await registry.fallbackInventory.setStock(eventId, count);

  console.log(`[Admin] Seeded event ${eventId} inventory counter to: ${count}`);
  res.status(200).json({ message: "Inventory seeded successfully.", eventId, count });
});

/**
 * 8. Toggle simulated Redis connection failure (Chaos Injection)
 */
app.post("/chaos/redis/toggle", (req, res) => {
  const registry = getRegistry();
  
  if (registry.inventory instanceof MemoryInventoryRepository) {
    redisOffline = !redisOffline;
    registry.inventory.setUnreachable(redisOffline);
    
    console.log(`[Chaos] Redis simulated network reachability toggled. Offline: ${redisOffline}`);
    return res.status(200).json({ redisOffline, storeType: "Memory" });
  } else {
    // For live LocalStack testing, we can simulate Redis offline in client configuration
    return res.status(400).json({ error: "Chaos toggle only supported in local memory testing mode." });
  }
});

/**
 * 9. Get all Ledger database transactions
 */
app.get("/ledger", async (req, res) => {
  const registry = getRegistry();
  const txs = await registry.ledger.getAllTransactions();
  res.status(200).json(txs);
});

// Start listening if run directly (not imported)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 ED-DRLE Local Gateway emulator listening on port ${PORT}`);
  });
}

export { app };
