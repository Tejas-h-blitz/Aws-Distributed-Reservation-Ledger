"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_sfn_1 = require("@aws-sdk/client-sfn");
const s3Client = new client_s3_1.S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
    region: process.env.AWS_DEFAULT_REGION || "us-east-1",
});
const sfnClient = new client_sfn_1.SFNClient({
    endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
    region: process.env.AWS_DEFAULT_REGION || "us-east-1",
});
async function streamToString(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
}
/**
 * AWS Lambda handler triggered by S3 ObjectCreated event.
 */
async function handler(event) {
    const records = event.Records || [];
    for (const record of records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
        try {
            console.log(`[Ingestion] Fetching settlement file: bucket=${bucket}, key=${key}`);
            const s3Response = await s3Client.send(new client_s3_1.GetObjectCommand({
                Bucket: bucket,
                Key: key,
            }));
            const content = await streamToString(s3Response.Body);
            const settlements = JSON.parse(content);
            if (!Array.isArray(settlements)) {
                console.warn(`[Ingestion] Invalid file format in ${key}. Expected array.`);
                continue;
            }
            for (const settlement of settlements) {
                console.log(`[Ingestion] Starting Step Functions audit flow for ReservationID: ${settlement.reservationId}`);
                await sfnClient.send(new client_sfn_1.StartExecutionCommand({
                    stateMachineArn: process.env.AUDIT_STATE_MACHINE_ARN || "arn:aws:states:us-east-1:000000000000:stateMachine:AuditStateMachine",
                    input: JSON.stringify({
                        settlementRecord: settlement,
                    }),
                }));
            }
        }
        catch (err) {
            console.error(`[Ingestion] Failed to process S3 settlement file ${key}:`, err);
            throw err;
        }
    }
}
