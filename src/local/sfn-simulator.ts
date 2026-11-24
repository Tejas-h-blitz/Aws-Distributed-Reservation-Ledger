import { handler as paymentHandler } from "../handlers/payment-mock";
import { handler as ledgerWriterHandler } from "../handlers/ledger-writer";
import { handler as compensateHandler } from "../handlers/compensate";
import { handler as auditReconcilerHandler, pendingHumanReviews } from "../handlers/audit-reconciler";
import { getRegistry } from "../registry";
import { logger } from "../utils/logger";
import { observability, TraceSpan } from "../utils/observability";
import { traceStorage } from "../utils/logger";
 
export class StepFunctionsSimulator {
  /**
   * Simulates the Standard Saga Workflow:
   * 1. Call Payment Handler (with retries)
   * 2. If Success: Call Ledger Writer
   * 3. If Failure: Call Compensate Lambda
   */
  static async executeSagaWorkflow(input: {
    ReservationID: string;
    EventID: string;
    UserID: string;
    Amount: number;
    Currency: string;
    UsedFallbackStore: boolean;
    ParentSpan?: TraceSpan;
  }): Promise<{ status: "SUCCESS" | "FAILED"; history: string[] }> {
    const history: string[] = ["State: SagaStarted"];
    const traceId = traceStorage.getStore() || "no-trace-context";
    const span = observability.startSpan(
      "saga",
      traceId,
      { reservationId: input.ReservationID },
      input.ParentSpan
    );
 
    // 1. Invoke Payment Processor
    history.push("State: InvokePaymentGateway");
    
    let paymentResult: any;
    let paymentAttempts = 0;
    const maxAttempts = 3;
 
    while (paymentAttempts < maxAttempts) {
      paymentAttempts++;
      paymentResult = await observability.runSpan(
        "saga.payment",
        traceId,
        { attempt: paymentAttempts },
        span,
        () => paymentHandler({
          ReservationID: input.ReservationID,
          Amount: input.Amount,
        }),
        result => !result.success
      );
 
      if (paymentResult.success) {
        history.push(`PaymentSucceeded (Attempt ${paymentAttempts})`);
        break;
      } else {
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
      const ledgerResult = await observability.runSpan(
        "saga.ledger",
        traceId,
        { reservationId: input.ReservationID },
        span,
        () => ledgerWriterHandler({
          ReservationID: input.ReservationID,
          UserID: input.UserID,
          Amount: input.Amount,
          Currency: input.Currency,
          TransactionID: paymentResult.transactionId,
        }),
        result => !result.success
      );
 
      if (ledgerResult.success) {
        history.push("State: SagaCompleted");
        observability.finishSpan(span, "OK", { status: "SUCCESS" });
        return { status: "SUCCESS", history };
      } else {
        history.push(`LedgerWriterFailed: ${ledgerResult.error}`);
      }
    }
 
    // Failure branch: Compensation (Revert reservation)
    history.push("State: InvokeCompensation");
    await observability.runSpan(
      "saga.compensation",
      traceId,
      { reservationId: input.ReservationID },
      span,
      () => compensateHandler({
        ReservationID: input.ReservationID,
        EventID: input.EventID,
        UsedFallbackStore: input.UsedFallbackStore,
      }),
      result => !result.success
    );
    history.push("State: SagaCompensated");
    observability.finishSpan(span, "ERROR", { status: "FAILED" });
    return { status: "FAILED", history };
  }
 
  /**
   * Simulates the Audit pipeline Standard Step Functions workflow:
   * 1. Run audit reconciler (using waitForTaskToken)
   * 2. If confidence >= 95%: Mark RECONCILED automatically and finish.
   * 3. If confidence < 95%: Pause workflow, fire SNS, and wait.
   */
  static async executeAuditWorkflow(settlementRecord: {
    reservationId: string;
    userId: string;
    amount: number;
    currency?: string;
  }): Promise<{ status: "RECONCILED" | "PENDING_HUMAN_REVIEW" | "FAILED"; reviewId?: string; explanation: string }> {
    const taskToken = `sfn_token_${Math.random().toString(36).substring(2, 11)}`;
    
    const res = await auditReconcilerHandler({
      taskToken,
      settlementRecord,
    });
 
    if (res.status === "RECONCILED") {
      return {
        status: "RECONCILED",
        explanation: res.explanation,
      };
    } else {
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
  static async approveAudit(reviewId: string, ledgerReservationId?: string): Promise<boolean> {
    const review = pendingHumanReviews.get(reviewId);
    if (!review) {
      throw new Error(`No pending audit review found for Reservation ID: ${reviewId}`);
    }
 
    const registry = getRegistry();
    // 1. Settle ledger transaction status as RECONCILED (use mapped ID if provided)
    const targetId = ledgerReservationId || reviewId;
    await registry.ledger.updateTransactionStatus(targetId, "RECONCILED");
 
    // 2. Remove review request from pending registry
    pendingHumanReviews.delete(reviewId);
    logger.info(`Human approved transaction. Resumed audit workflow successfully`, { ReservationID: reviewId, ledgerReservationId: targetId });
    return true;
  }
}
