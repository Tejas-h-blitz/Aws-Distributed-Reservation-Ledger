"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StepFunctionsSimulator = void 0;
const payment_mock_1 = require("../handlers/payment-mock");
const ledger_writer_1 = require("../handlers/ledger-writer");
const compensate_1 = require("../handlers/compensate");
const audit_reconciler_1 = require("../handlers/audit-reconciler");
const registry_1 = require("../registry");
class StepFunctionsSimulator {
    /**
     * Simulates the Standard Saga Workflow:
     * 1. Call Payment Handler (with retries)
     * 2. If Success: Call Ledger Writer
     * 3. If Failure: Call Compensate Lambda
     */
    static async executeSagaWorkflow(input) {
        const history = ["State: SagaStarted"];
        // 1. Invoke Payment Processor
        history.push("State: InvokePaymentGateway");
        let paymentResult;
        let paymentAttempts = 0;
        const maxAttempts = 3;
        while (paymentAttempts < maxAttempts) {
            paymentAttempts++;
            paymentResult = await (0, payment_mock_1.handler)({
                ReservationID: input.ReservationID,
                Amount: input.Amount,
            });
            if (paymentResult.success) {
                history.push(`PaymentSucceeded (Attempt ${paymentAttempts})`);
                break;
            }
            else {
                history.push(`PaymentFailed: ${paymentResult.error} (Attempt ${paymentAttempts}/${maxAttempts})`);
                if (paymentAttempts < maxAttempts) {
                    // Brief sleep to simulate backoff before retry
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        }
        // 2. Branch Choice
        if (paymentResult.success) {
            // Success branch: Settle Ledger
            history.push("State: InvokeLedgerWriter");
            const ledgerResult = await (0, ledger_writer_1.handler)({
                ReservationID: input.ReservationID,
                UserID: input.UserID,
                Amount: input.Amount,
                Currency: input.Currency,
                TransactionID: paymentResult.transactionId,
            });
            if (ledgerResult.success) {
                history.push("State: SagaCompleted");
                return { status: "SUCCESS", history };
            }
            else {
                history.push(`LedgerWriterFailed: ${ledgerResult.error}`);
            }
        }
        // Failure branch: Compensation (Revert reservation)
        history.push("State: InvokeCompensation");
        await (0, compensate_1.handler)({
            ReservationID: input.ReservationID,
            EventID: input.EventID,
            UsedFallbackStore: input.UsedFallbackStore,
        });
        history.push("State: SagaCompensated");
        return { status: "FAILED", history };
    }
    /**
     * Simulates the Audit pipeline Standard Step Functions workflow:
     * 1. Run audit reconciler (using waitForTaskToken)
     * 2. If confidence >= 95%: Mark RECONCILED automatically and finish.
     * 3. If confidence < 95%: Pause workflow, fire SNS, and wait.
     */
    static async executeAuditWorkflow(settlementRecord) {
        const taskToken = `sfn_token_${Math.random().toString(36).substring(2, 11)}`;
        const res = await (0, audit_reconciler_1.handler)({
            taskToken,
            settlementRecord,
        });
        if (res.status === "RECONCILED") {
            return {
                status: "RECONCILED",
                explanation: res.explanation,
            };
        }
        else {
            const reviewId = settlementRecord.reservationId;
            return {
                status: "PENDING_HUMAN_REVIEW",
                reviewId,
                explanation: res.explanation,
            };
        }
    }
    /**
     * Resumes a paused audit workflow on human approval.
     * Allows mapping an ambiguous review ID to a real ledger Reservation ID.
     */
    static async approveAudit(reviewId, ledgerReservationId) {
        const review = audit_reconciler_1.pendingHumanReviews.get(reviewId);
        if (!review) {
            throw new Error(`No pending audit review found for Reservation ID: ${reviewId}`);
        }
        const registry = (0, registry_1.getRegistry)();
        // 1. Settle ledger transaction status as RECONCILED (use mapped ID if provided)
        const targetId = ledgerReservationId || reviewId;
        await registry.ledger.updateTransactionStatus(targetId, "RECONCILED");
        // 2. Remove review request from pending registry
        audit_reconciler_1.pendingHumanReviews.delete(reviewId);
        console.log(`[SFN-Simulator] Human approved transaction. Resumed audit workflow successfully for ReservationID: ${reviewId}`);
        return true;
    }
}
exports.StepFunctionsSimulator = StepFunctionsSimulator;
