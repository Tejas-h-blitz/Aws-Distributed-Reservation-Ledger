"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const hold_1 = require("../handlers/hold");
const sfn_simulator_1 = require("./sfn-simulator");
const registry_1 = require("../registry");
const inventory_memory_1 = require("../repository/inventory.memory");
const audit_reconciler_1 = require("../handlers/audit-reconciler");
const app = (0, express_1.default)();
exports.app = app;
app.use(express_1.default.json());
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
    const response = await (0, hold_1.handler)(event);
    // Set headers
    if (response.headers) {
        for (const [key, value] of Object.entries(response.headers)) {
            res.setHeader(key, value);
        }
    }
    res.status(response.statusCode).send(response.body);
    // 2. Event-Driven Saga Simulation (Asynchronous Path)
    // If the reservation hold was accepted (HTTP 202), trigger the Step Functions saga in the background
    if (response.statusCode === 202) {
        const holdData = JSON.parse(response.body);
        // Launch background Saga (Non-blocking)
        setImmediate(async () => {
            console.log(`[EventBridge] Forwarding HoldCreated event for ReservationID: ${holdData.ReservationID} to Step Functions`);
            const sagaResult = await sfn_simulator_1.StepFunctionsSimulator.executeSagaWorkflow({
                ReservationID: holdData.ReservationID,
                EventID: holdData.EventID,
                UserID: holdData.UserID,
                Amount: 125.50, // standard seat amount
                Currency: "USD",
                UsedFallbackStore: holdData.UsedFallbackStore || false,
            });
            console.log(`[StepFunctions] Saga execution finished. Status: ${sagaResult.status}. History:`, sagaResult.history);
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
    console.log(`[S3] Settlement file containing ${settlements.length} records landed in bucket.`);
    const results = [];
    for (const record of settlements) {
        const auditRes = await sfn_simulator_1.StepFunctionsSimulator.executeAuditWorkflow(record);
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
    const reviews = Array.from(audit_reconciler_1.pendingHumanReviews.entries()).map(([reviewId, data]) => ({
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
        const success = await sfn_simulator_1.StepFunctionsSimulator.approveAudit(reviewId, ledgerReservationId);
        return res.status(200).json({ success, message: `Review ${reviewId} approved, transaction status reconciled.` });
    }
    catch (error) {
        return res.status(404).json({ error: error.message });
    }
});
/**
 * 6. Get live stock metrics
 */
app.get("/inventory/:eventId", async (req, res) => {
    const { eventId } = req.params;
    const registry = (0, registry_1.getRegistry)();
    let redisStock = -1;
    try {
        redisStock = await registry.inventory.getCurrentStock(eventId);
    }
    catch (err) {
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
    const registry = (0, registry_1.getRegistry)();
    try {
        await registry.inventory.setStock(eventId, count);
    }
    catch {
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
    const registry = (0, registry_1.getRegistry)();
    if (registry.inventory instanceof inventory_memory_1.MemoryInventoryRepository) {
        redisOffline = !redisOffline;
        registry.inventory.setUnreachable(redisOffline);
        console.log(`[Chaos] Redis simulated network reachability toggled. Offline: ${redisOffline}`);
        return res.status(200).json({ redisOffline, storeType: "Memory" });
    }
    else {
        // For live LocalStack testing, we can simulate Redis offline in client configuration
        return res.status(400).json({ error: "Chaos toggle only supported in local memory testing mode." });
    }
});
/**
 * 9. Get all Ledger database transactions
 */
app.get("/ledger", async (req, res) => {
    const registry = (0, registry_1.getRegistry)();
    const txs = await registry.ledger.getAllTransactions();
    res.status(200).json(txs);
});
// Start listening if run directly (not imported)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 ED-DRLE Local Gateway emulator listening on port ${PORT}`);
    });
}
