import { InventoryRepository } from "./repository/inventory.interface";
import { HoldRepository } from "./repository/hold.interface";
import { LedgerRepository } from "./repository/ledger.interface";
import { IdempotencyStore, MemoryIdempotencyStore } from "./utils/idempotency";

import { RedisInventoryRepository } from "./repository/inventory.redis";
import { DynamoDBInventoryRepository } from "./repository/inventory.dynamo";
import { DynamoDBHoldRepository } from "./repository/hold.dynamodb";
import { PostgresLedgerRepository } from "./repository/ledger.postgres";

export interface ServiceRegistry {
  inventory: InventoryRepository;          // Primary Redis inventory counter
  fallbackInventory: InventoryRepository;  // Fallback DynamoDB inventory counter
  holds: HoldRepository;                  // ActiveHolds table
  ledger: LedgerRepository;                // Postgres Ledger database
  idempotency: IdempotencyStore;          // Idempotency records store
}

let currentRegistry: ServiceRegistry | null = null;

// DynamoDB-backed Idempotency store placeholder
class DynamoDBIdempotencyStore implements IdempotencyStore {
  // Simple representation. In real AWS, it would write to the Idempotency table.
  // For local LocalStack, we can use DynamoDBDocumentClient to write to Idempotency table.
  // Let's implement it fully!
  private holdRepo: DynamoDBHoldRepository;

  constructor() {
    this.holdRepo = new DynamoDBHoldRepository();
  }

  async getRecord(key: string) {
    // We can use a DynamoDB document client query directly or map it.
    // To keep it simple, we can store idempotency records in a dedicated DynamoDB table.
    // For local stack runs, we will use a simple DynamoDB-backed store:
    try {
      const db = new (require("@aws-sdk/client-dynamodb").DynamoDBClient)({
        endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
        region: process.env.AWS_DEFAULT_REGION || "us-east-1",
      });
      const doc = require("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient.from(db);
      const res = await doc.send(
        new (require("@aws-sdk/lib-dynamodb").GetCommand)({
          TableName: "Idempotency",
          Key: { IdempotencyKey: key },
        })
      );
      if (!res.Item) return null;
      // TTL verification
      if (Date.now() / 1000 > res.Item.expirationTime) {
        return null;
      }
      return res.Item as any;
    } catch {
      return null;
    }
  }

  async saveRecord(key: string, record: any) {
    try {
      const db = new (require("@aws-sdk/client-dynamodb").DynamoDBClient)({
        endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
        region: process.env.AWS_DEFAULT_REGION || "us-east-1",
      });
      const doc = require("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient.from(db);
      await doc.send(
        new (require("@aws-sdk/lib-dynamodb").PutCommand)({
          TableName: "Idempotency",
          Item: {
            IdempotencyKey: key,
            ...record,
          },
        })
      );
    } catch (e) {
      console.error("Failed to save idempotency record to DynamoDB", e);
    }
  }
}

export function getRegistry(): ServiceRegistry {
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
        idempotency: new MemoryIdempotencyStore(),
      };
    } else {
      currentRegistry = {
        inventory: new RedisInventoryRepository(),
        fallbackInventory: new DynamoDBInventoryRepository(),
        holds: new DynamoDBHoldRepository(),
        ledger: new PostgresLedgerRepository(),
        idempotency: new DynamoDBIdempotencyStore(),
      };
    }
  }
  return currentRegistry;
}

export function setRegistry(registry: ServiceRegistry) {
  currentRegistry = registry;
}
