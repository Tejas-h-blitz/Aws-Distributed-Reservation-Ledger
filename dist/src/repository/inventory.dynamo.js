"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBInventoryRepository = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
class DynamoDBInventoryRepository {
    docClient;
    constructor(client) {
        const ddbClient = client || new client_dynamodb_1.DynamoDBClient({
            endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
            region: process.env.AWS_DEFAULT_REGION || "us-east-1",
        });
        this.docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(ddbClient);
    }
    /**
     * Decrements stock conditional update:
     * UPDATE InventoryCounters SET RemainingStock = RemainingStock - 1 WHERE RemainingStock > 0
     */
    async decrementStock(eventId) {
        try {
            await this.docClient.send(new lib_dynamodb_1.UpdateCommand({
                TableName: "InventoryCounters",
                Key: { EventID: eventId },
                UpdateExpression: "SET RemainingStock = RemainingStock - :one",
                ConditionExpression: "RemainingStock > :zero",
                ExpressionAttributeValues: {
                    ":one": 1,
                    ":zero": 0,
                },
            }));
            return true;
        }
        catch (error) {
            if (error.name === "ConditionalCheckFailedException") {
                return false; // Out of stock
            }
            throw error;
        }
    }
    async incrementStock(eventId) {
        await this.docClient.send(new lib_dynamodb_1.UpdateCommand({
            TableName: "InventoryCounters",
            Key: { EventID: eventId },
            UpdateExpression: "SET RemainingStock = RemainingStock + :one",
            ExpressionAttributeValues: {
                ":one": 1,
            },
        }));
    }
    async getCurrentStock(eventId) {
        const res = await this.docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: "InventoryCounters",
            Key: { EventID: eventId },
        }));
        if (!res.Item)
            return -1;
        return res.Item.RemainingStock;
    }
    async setStock(eventId, count) {
        await this.docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: "InventoryCounters",
            Item: {
                EventID: eventId,
                RemainingStock: count,
            },
        }));
    }
}
exports.DynamoDBInventoryRepository = DynamoDBInventoryRepository;
