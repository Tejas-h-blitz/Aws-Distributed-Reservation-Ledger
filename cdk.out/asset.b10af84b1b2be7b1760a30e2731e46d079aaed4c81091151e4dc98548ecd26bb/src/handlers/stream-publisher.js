"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const ebClient = new client_eventbridge_1.EventBridgeClient({
    endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
    region: process.env.AWS_DEFAULT_REGION || "us-east-1",
});
/**
 * DynamoDB Stream listener that publishes new reservation holds to EventBridge.
 */
async function handler(event) {
    const records = event.Records || [];
    const entries = [];
    for (const record of records) {
        // Saga triggers on new holds (INSERT)
        if (record.eventName === "INSERT") {
            const newImage = record.dynamodb?.NewImage;
            if (!newImage)
                continue;
            const holdId = newImage.HoldID?.S;
            const eventId = newImage.EventID?.S;
            const userId = newImage.UserID?.S;
            const exp = newImage.ExpirationTimestamp?.N ? parseInt(newImage.ExpirationTimestamp.N, 10) : 0;
            const status = newImage.Status?.S;
            if (status === "PENDING" && holdId && eventId && userId) {
                entries.push({
                    Source: "ed.drle.reservation",
                    DetailType: "HoldCreated",
                    Detail: JSON.stringify({
                        HoldID: holdId,
                        EventID: eventId,
                        UserID: userId,
                        ExpirationTimestamp: exp,
                        Amount: 125.50, // Standard ticket item value
                        Currency: "USD",
                    }),
                    EventBusName: process.env.EVENT_BUS_NAME || "ed-drle-bus",
                });
            }
        }
    }
    if (entries.length > 0) {
        try {
            await ebClient.send(new client_eventbridge_1.PutEventsCommand({
                Entries: entries,
            }));
            console.log(`[StreamPublisher] Successfully forwarded ${entries.length} hold event(s) to EventBridge.`);
        }
        catch (err) {
            console.error("[StreamPublisher] Failed to publish event(s) to EventBridge:", err);
            throw err;
        }
    }
}
