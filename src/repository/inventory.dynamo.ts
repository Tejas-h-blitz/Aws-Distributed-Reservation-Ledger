import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { InventoryRepository } from "./inventory.interface";

export class DynamoDBInventoryRepository implements InventoryRepository {
  private docClient: DynamoDBDocumentClient;

  constructor(client?: DynamoDBClient) {
    const ddbClient = client || new DynamoDBClient({
      endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
      region: process.env.AWS_DEFAULT_REGION || "us-east-1",
    });
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
  }

  /**
   * Decrements stock conditional update:
   * UPDATE InventoryCounters SET RemainingStock = RemainingStock - 1 WHERE RemainingStock > 0
   */
  async decrementStock(eventId: string): Promise<boolean> {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: "InventoryCounters",
          Key: { EventID: eventId },
          UpdateExpression: "SET RemainingStock = RemainingStock - :one",
          ConditionExpression: "RemainingStock > :zero",
          ExpressionAttributeValues: {
            ":one": 1,
            ":zero": 0,
          },
        })
      );
      return true;
    } catch (error: any) {
      if (error.name === "ConditionalCheckFailedException") {
        return false; // Out of stock
      }
      throw error;
    }
  }

  async incrementStock(eventId: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: "InventoryCounters",
        Key: { EventID: eventId },
        UpdateExpression: "SET RemainingStock = RemainingStock + :one",
        ExpressionAttributeValues: {
          ":one": 1,
        },
      })
    );
  }

  async getCurrentStock(eventId: string): Promise<number> {
    const res = await this.docClient.send(
      new GetCommand({
        TableName: "InventoryCounters",
        Key: { EventID: eventId },
      })
    );
    if (!res.Item) return -1;
    return res.Item.RemainingStock;
  }

  async setStock(eventId: string, count: number): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: "InventoryCounters",
        Item: {
          EventID: eventId,
          RemainingStock: count,
        },
      })
    );
  }
}
