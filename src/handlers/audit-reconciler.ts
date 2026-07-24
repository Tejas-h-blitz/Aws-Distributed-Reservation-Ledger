import { SFNClient, SendTaskSuccessCommand } from "@aws-sdk/client-sfn";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { getRegistry } from "../registry";
import { getAuditReasoner } from "../utils/audit-reasoner";
import { logger } from "../utils/logger";
 
const sfnClient = new SFNClient({
  endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
  region: process.env.AWS_DEFAULT_REGION || "us-east-1",
 street: "", // dummy required for type compatibility if any
} as any);
 
const snsClient = new SNSClient({
  endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
  region: process.env.AWS_DEFAULT_REGION || "us-east-1",
} as any);
 
// Human Review Registry for in-memory tracking in the local server
export const pendingHumanReviews = new Map<string, {
  taskToken: string;
  settlementRecord: any;
  explanation: string;
}>();
 
export async function handler(event: any): Promise<any> {
  const { taskToken, settlementRecord } = event;
  if (!settlementRecord) {
    logger.warn("Audit reconciler invoked with missing settlementRecord", { event });
    return {
      success: false,
      error: "Missing 'settlementRecord' in the event payload.",
    };
  }
 
  const registry = getRegistry();
  const reasoner = getAuditReasoner();
 
  try {
    // 1. Fetch transaction candidates from PostgreSQL/Memory ledger
    const candidates = await registry.ledger.getAllTransactions();
 
    // 2. Perform audit reconciliation
    const auditResult = await reasoner.reconcile(settlementRecord, candidates);
    logger.info(`Audit reconciliation evaluation complete`, {
      confidence: auditResult.confidence,
      matchedTransactionId: auditResult.matchedTransactionId,
      explanation: auditResult.explanation,
      reservationId: settlementRecord.reservationId,
    });
 
    if (auditResult.confidence >= 95 && auditResult.matchedTransactionId) {
      // 3. Auto-reconcile: Update ledger state to RECONCILED
      const reservationId = settlementRecord.reservationId;
      await registry.ledger.updateTransactionStatus(reservationId, "RECONCILED");
 
      // Resume SFN standard workflow (if taskToken exists)
      if (taskToken) {
        await sfnClient.send(
          new SendTaskSuccessCommand({
            taskToken: taskToken,
            output: JSON.stringify({ status: "RECONCILED", autoApproved: true }),
          })
        );
      }
      return {
        status: "RECONCILED",
        autoApproved: true,
        confidence: auditResult.confidence,
        explanation: auditResult.explanation,
      };
    } else {
      // 4. Low Confidence / Discrepancy -> PAUSE Workflow and notify SNS (Slack simulation)
      logger.warn(`Low confidence/discrepancy detected in settlement audit. Pausing audit pipeline for human review.`, {
        confidence: auditResult.confidence,
        reservationId: settlementRecord.reservationId,
      });
 
      if (taskToken) {
        // Track the review request locally so humans can retrieve and approve it
        const reviewId = settlementRecord.reservationId || `rev_${Math.random().toString(36).substring(2, 9)}`;
        pendingHumanReviews.set(reviewId, {
          taskToken,
          settlementRecord,
          explanation: auditResult.explanation,
        });
 
        // Publish Alert to SNS
        const snsMessage = {
          alert: "CRITICAL_AUDIT_PENDING_REVIEW",
          reviewId,
          explanation: auditResult.explanation,
          confidence: auditResult.confidence,
          settlementRecord,
          taskToken, // Passed along to allow direct resolution via SNS receiver/slack action
        };
 
        try {
          await snsClient.send(
            new PublishCommand({
              TopicArn: process.env.SNS_TOPIC_ARN || "arn:aws:sns:us-east-1:000000000000:ed-drle-slack-topic",
              Message: JSON.stringify(snsMessage),
              Subject: "⚠️ Audit Alert: Discrepancy Found. Action Required.",
            })
          );
          logger.info(`SNS notification published successfully for reviewId`, { reviewId });
        } catch (snsError: any) {
          logger.error("Failed to publish SNS notification", snsError, { reviewId });
        }
      }
 
      return {
        status: "PENDING_HUMAN_REVIEW",
        confidence: auditResult.confidence,
        explanation: auditResult.explanation,
      };
    }
  } catch (err: any) {
    logger.error("Exception occurred during reconciliation", err);
    return {
      success: false,
      error: err.message,
    };
  }
}
