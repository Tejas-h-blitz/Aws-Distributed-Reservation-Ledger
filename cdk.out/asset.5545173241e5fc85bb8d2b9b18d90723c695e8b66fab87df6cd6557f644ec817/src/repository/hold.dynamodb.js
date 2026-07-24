"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBHoldRepository = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
class DynamoDBHoldRepository {
    docClient;
    constructor(client) {
        const ddbClient = client || new client_dynamodb_1.DynamoDBClient({
            endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
            region: process.env.AWS_DEFAULT_REGION || "us-east-1",
        });
        this.docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(ddbClient);
    }
    async createHold(hold) {
        await this.docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: "ActiveHolds",
            Item: {
                ...hold,
                Version: 1, // Start with version 1
            },
            ConditionExpression: "attribute_not_exists(HoldID)",
        }));
    }
    async getHold(holdId) {
        const res = await this.docClient.send(new lib_dynamodb_1.GetCommand({
            TableName: "ActiveHolds",
            Key: { HoldID: holdId },
        }));
        return res.Item || null;
    }
    async updateHoldStatus(holdId, status, expectedVersion) {
        await this.docClient.send(new lib_dynamodb_1.UpdateCommand({
            TableName: "ActiveHolds",
            Key: { HoldID: holdId },
            UpdateExpression: "SET #status = :status, Version = Version + :one",
            ConditionExpression: "Version = :expectedVersion",
            ExpressionAttributeNames: {
                "#status": "Status",
            },
            ExpressionAttributeValues: {
                ":status": status,
                ":expectedVersion": expectedVersion,
                ":one": 1,
            },
        }));
    }
    async deleteHold(holdId) {
        await this.docClient.send(new lib_dynamodb_1.DeleteCommand({
            TableName: "ActiveHolds",
            Key: { HoldID: holdId },
        }));
    }
    async getHoldsByEventId(eventId) {
        const res = await this.docClient.send(new lib_dynamodb_1.QueryCommand({
            TableName: "ActiveHolds",
            IndexName: "EventIDStatusIndex",
            KeyConditionExpression: "EventID = :eventId",
            ExpressionAttributeValues: {
                ":eventId": eventId,
            },
        }));
        return res.Items || [];
    }
    async getAllHolds() {
        const res = await this.docClient.send(new lib_dynamodb_1.ScanCommand({
            TableName: "ActiveHolds",
        }));
        return res.Items || [];
    }
}
exports.DynamoDBHoldRepository = DynamoDBHoldRepository;
