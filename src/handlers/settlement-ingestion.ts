import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { Readable } from "stream";

const s3Client = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
  region: process.env.AWS_DEFAULT_REGION || "us-east-1",
});

const sfnClient = new SFNClient({
  endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
  region: process.env.AWS_DEFAULT_REGION || "us-east-1",
});

async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

/**
 * AWS Lambda handler triggered by S3 ObjectCreated event.
 */
export async function handler(event: any): Promise<void> {
  const records = event.Records || [];
  
  for (const record of records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    try {
      console.log(`[Ingestion] Fetching settlement file: bucket=${bucket}, key=${key}`);
      const s3Response = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );

      const content = await streamToString(s3Response.Body as Readable);
      const settlements = JSON.parse(content);

      if (!Array.isArray(settlements)) {
        console.warn(`[Ingestion] Invalid file format in ${key}. Expected array.`);
        continue;
      }

      for (const settlement of settlements) {
        console.log(`[Ingestion] Starting Step Functions audit flow for ReservationID: ${settlement.reservationId}`);
        await sfnClient.send(
          new StartExecutionCommand({
            stateMachineArn: process.env.AUDIT_STATE_MACHINE_ARN || "arn:aws:states:us-east-1:000000000000:stateMachine:AuditStateMachine",
            input: JSON.stringify({
              settlementRecord: settlement,
            }),
          })
        );
      }
    } catch (err: any) {
      console.error(`[Ingestion] Failed to process S3 settlement file ${key}:`, err);
      throw err;
    }
  }
}
