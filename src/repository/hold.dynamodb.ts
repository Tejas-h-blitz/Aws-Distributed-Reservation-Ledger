import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { HoldRepository, HoldRecord } from "./hold.interface";

export class DynamoDBHoldRepository implements HoldRepository {
  private docClient: DynamoDBDocumentClient;

  constructor(client?: DynamoDBClient) {
    const ddbClient = client || new DynamoDBClient({
      endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
      region: process.env.AWS_DEFAULT_REGION || "us-east-1",
    });
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  async createHold(hold: Omit<HoldRecord, "Version">): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: "ActiveHolds",
        Item: {
          ...hold,
          Version: 1, // Start with version 1
        },
        ConditionExpression: "attribute_not_exists(HoldID)",
      })
    );
  }

  async getHold(holdId: string): Promise<HoldRecord | null> {
    const res = await this.docClient.send(
      new GetCommand({
        TableName: "ActiveHolds",
        Key: { HoldID: holdId },
      })
    );
    return (res.Item as HoldRecord) || null;
  }

  async updateHoldStatus(holdId: string, status: HoldRecord["Status"], expectedVersion: number): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
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
      })
    );
  }

  async deleteHold(holdId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: "ActiveHolds",
        Key: { HoldID: holdId },
      })
    );
  }

  async getHoldsByEventId(eventId: string): Promise<HoldRecord[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: "ActiveHolds",
        IndexName: "EventIDStatusIndex",
        KeyConditionExpression: "EventID = :eventId",
        ExpressionAttributeValues: {
          ":eventId": eventId,
        },
      })
    );
    return (res.Items as HoldRecord[]) || [];
  }

  async getAllHolds(): Promise<HoldRecord[]> {
    const res = await this.docClient.send(
      new ScanCommand({
        TableName: "ActiveHolds",
      })
    );
    return (res.Items as HoldRecord[]) || [];
  }
}
