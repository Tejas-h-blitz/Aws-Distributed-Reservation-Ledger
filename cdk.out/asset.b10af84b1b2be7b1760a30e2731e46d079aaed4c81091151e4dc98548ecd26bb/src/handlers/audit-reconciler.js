"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingHumanReviews = void 0;
exports.handler = handler;
const client_sfn_1 = require("@aws-sdk/client-sfn");
const client_sns_1 = require("@aws-sdk/client-sns");
const registry_1 = require("../registry");
const audit_reasoner_1 = require("../utils/audit-reasoner");
const sfnClient = new client_sfn_1.SFNClient({
    endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
    region: process.env.AWS_DEFAULT_REGION || "us-east-1",
});
const snsClient = new client_sns_1.SNSClient({
    endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
    region: process.env.AWS_DEFAULT_REGION || "us-east-1",
});
// Human Review Registry for in-memory tracking in the local server
exports.pendingHumanReviews = new Map();
async function handler(event) {
    const { taskToken, settlementRecord } = event;
    if (!settlementRecord) {
        return {
            success: false,
            error: "Missing 'settlementRecord' in the event payload.",
        };
    }
    const registry = (0, registry_1.getRegistry)();
    const reasoner = (0, audit_reasoner_1.getAuditReasoner)();
    try {
        // 1. Fetch transaction candidates from PostgreSQL/Memory ledger
        const candidates = await registry.ledger.getAllTransactions();
        // 2. Perform audit reconciliation
        const auditResult = await reasoner.reconcile(settlementRecord, candidates);
        console.log(`[AuditReconciler] Audit result: confidence=${auditResult.confidence}%, matchedTx=${auditResult.matchedTransactionId}. Explanation: ${auditResult.explanation}`);
        if (auditResult.confidence >= 95 && auditResult.matchedTransactionId) {
            // 3. Auto-reconcile: Update ledger state to RECONCILED
            const reservationId = settlementRecord.reservationId;
            await registry.ledger.updateTransactionStatus(reservationId, "RECONCILED");
            // Resume SFN standard workflow (if taskToken exists)
            if (taskToken) {
                await sfnClient.send(new client_sfn_1.SendTaskSuccessCommand({
                    taskToken: taskToken,
                    output: JSON.stringify({ status: "RECONCILED", autoApproved: true }),
                }));
            }
            return {
                status: "RECONCILED",
                autoApproved: true,
                confidence: auditResult.confidence,
                explanation: auditResult.explanation,
            };
        }
        else {
            // 4. Low Confidence / Discrepancy -> PAUSE Workflow and notify SNS (Slack simulation)
            console.log(`[AuditReconciler] Low confidence/discrepancy detected. Pausing saga for human approval.`);
            if (taskToken) {
                // Track the review request locally so humans can retrieve and approve it
                const reviewId = settlementRecord.reservationId || `rev_${Math.random().toString(36).substring(2, 9)}`;
                exports.pendingHumanReviews.set(reviewId, {
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
                    await snsClient.send(new client_sns_1.PublishCommand({
                        TopicArn: process.env.SNS_TOPIC_ARN || "arn:aws:sns:us-east-1:000000000000:ed-drle-slack-topic",
                        Message: JSON.stringify(snsMessage),
                        Subject: "⚠️ Audit Alert: Discrepancy Found. Action Required.",
                    }));
                    console.log(`[AuditReconciler] SNS notification published successfully for reviewId: ${reviewId}`);
                }
                catch (snsError) {
                    console.error("[AuditReconciler] Failed to publish SNS notification:", snsError);
                }
            }
            return {
                status: "PENDING_HUMAN_REVIEW",
                confidence: auditResult.confidence,
                explanation: auditResult.explanation,
            };
        }
    }
    catch (err) {
        console.error("[AuditReconciler] Exception occurred during reconciliation:", err);
        return {
            success: false,
            error: err.message,
        };
    }
}
