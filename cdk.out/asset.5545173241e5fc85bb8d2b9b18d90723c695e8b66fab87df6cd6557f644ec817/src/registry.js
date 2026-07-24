"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegistry = getRegistry;
exports.setRegistry = setRegistry;
const idempotency_1 = require("./utils/idempotency");
const inventory_redis_1 = require("./repository/inventory.redis");
const inventory_dynamo_1 = require("./repository/inventory.dynamo");
const hold_dynamodb_1 = require("./repository/hold.dynamodb");
const ledger_postgres_1 = require("./repository/ledger.postgres");
let currentRegistry = null;
// DynamoDB-backed Idempotency store placeholder
class DynamoDBIdempotencyStore {
    // Simple representation. In real AWS, it would write to the Idempotency table.
    // For local LocalStack, we can use DynamoDBDocumentClient to write to Idempotency table.
    // Let's implement it fully!
    holdRepo;
    constructor() {
        this.holdRepo = new hold_dynamodb_1.DynamoDBHoldRepository();
    }
    async getRecord(key) {
        // We can use a DynamoDB document client query directly or map it.
        // To keep it simple, we can store idempotency records in a dedicated DynamoDB table.
        // For local stack runs, we will use a simple DynamoDB-backed store:
        try {
            const db = new (require("@aws-sdk/client-dynamodb").DynamoDBClient)({
                endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
                region: process.env.AWS_DEFAULT_REGION || "us-east-1",
            });
            const doc = require("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient.from(db);
            const res = await doc.send(new (require("@aws-sdk/lib-dynamodb").GetCommand)({
                TableName: "Idempotency",
                Key: { IdempotencyKey: key },
            }));
            if (!res.Item)
                return null;
            // TTL verification
            if (Date.now() / 1000 > res.Item.expirationTime) {
                return null;
            }
            return res.Item;
        }
        catch {
            return null;
        }
    }
    async saveRecord(key, record) {
        try {
            const db = new (require("@aws-sdk/client-dynamodb").DynamoDBClient)({
                endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
                region: process.env.AWS_DEFAULT_REGION || "us-east-1",
            });
            const doc = require("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient.from(db);
            await doc.send(new (require("@aws-sdk/lib-dynamodb").PutCommand)({
                TableName: "Idempotency",
                Item: {
                    IdempotencyKey: key,
                    ...record,
                },
            }));
        }
        catch (e) {
            console.error("Failed to save idempotency record to DynamoDB", e);
        }
    }
}
function getRegistry() {
    if (!currentRegistry) {
        // Lazily initialize with production-level (or LocalStack-level) real clients
        const isLocalTesting = process.env.LOCAL_TESTING === "true";
        if (isLocalTesting) {
            const { MemoryInventoryRepository } = require("./repository/inventory.memory");
            const { MemoryHoldRepository } = require("./repository/hold.memory");
            const { MemoryLedgerRepository } = require("./repository/ledger.memory");
            currentRegistry = {
                inventory: new MemoryInventoryRepository(),
                fallbackInventory: new MemoryInventoryRepository(),
                holds: new MemoryHoldRepository(),
                ledger: new MemoryLedgerRepository(),
                idempotency: new idempotency_1.MemoryIdempotencyStore(),
            };
        }
        else {
            currentRegistry = {
                inventory: new inventory_redis_1.RedisInventoryRepository(),
                fallbackInventory: new inventory_dynamo_1.DynamoDBInventoryRepository(),
                holds: new hold_dynamodb_1.DynamoDBHoldRepository(),
                ledger: new ledger_postgres_1.PostgresLedgerRepository(),
                idempotency: new DynamoDBIdempotencyStore(),
            };
        }
    }
    return currentRegistry;
}
function setRegistry(registry) {
    currentRegistry = registry;
}
