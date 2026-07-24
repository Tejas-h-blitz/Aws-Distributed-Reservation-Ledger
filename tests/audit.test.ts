import { getRegistry } from "../src/registry";

/**
 * Audit Pipeline Pause and Human Approval Test
 * Asserts that settlement records matching with low confidence (<95%)
 * pause saga execution, request human review, and only update the ledger once approved.
 */
export async function runAuditTest(baseUrl: string): Promise<boolean> {
  console.log("\n=== 5. Audit Pause Test (Human-in-the-Loop) ===");
  const reservationId = "res_audit_ambiguous_777";
  const userId = "user_audit_subject_777";
  const amount = 150.00;

  const registry = getRegistry();

  // 1. Pre-populate ledger transaction as PENDING
  console.log("Seeding pending transaction in database ledger...");
  await registry.ledger.createTransaction({
    reservation_id: reservationId,
    user_id: userId,
    amount: amount,
    currency: "USD",
    account_debited: `acct_${userId}`,
    account_credited: "acct_merchant",
    status: "PENDING",
  });

  // 2. Prepare settlement record that is ambiguous (same userId and amount, but different Reservation ID)
  // This will force FuzzyAuditReasoner score to 70% (which is < 95% threshold)
  const settlementRecord = {
    reservationId: "res_mismatch_settle_id_888", // Mismatched Reservation ID
    userId: userId,
    amount: amount,
  };

  console.log("Uploading ambiguous settlement file to audit pipeline...");
  const uploadRes = await fetch(`${baseUrl}/audit/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([settlementRecord]),
  });

  const uploadData = await uploadRes.json() as any;
  const statusAfterUpload = uploadData.results[0].status;
  console.log(`  - Audit processing state: ${statusAfterUpload}`);

  const assertPaused = statusAfterUpload === "PENDING_HUMAN_REVIEW";

  // Assert ledger entry is still PENDING
  const txRecord = await registry.ledger.getTransactionByReservationId(reservationId);
  const statusBeforeApproval = txRecord ? txRecord.status : "NOT_FOUND";
  console.log(`  - Ledger entry status prior to human review approval: ${statusBeforeApproval}`);

  const assertStillPending = statusBeforeApproval === "PENDING";

  // 3. Query pending reviews
  const pendingRes = await fetch(`${baseUrl}/audit/pending`);
  const pendingList = await pendingRes.json() as any;
  console.log(`  - Pending Human Reviews count: ${pendingList.length}`);
  
  const assertInPendingQueue = pendingList.some((r: any) => r.reviewId === settlementRecord.reservationId);
  console.log(`  - Review present in human verification queue: ${assertInPendingQueue}`);

  // 4. Perform human approval mapping the review to our real ledger record
  console.log(`Simulating human review approval mapping review ${settlementRecord.reservationId} to ledger ${reservationId}...`);
  const approveRes = await fetch(`${baseUrl}/audit/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reviewId: settlementRecord.reservationId,
      ledgerReservationId: reservationId,
    }),
  });

  const approveData = await approveRes.json() as any;
  console.log(`  - Approval response: HTTP ${approveRes.status}, success=${approveData.success}`);

  const assertApproveSuccess = approveData.success === true;

  // 5. Verify transaction is now RECONCILED in the database ledger
  const finalTxRecord = await registry.ledger.getTransactionByReservationId(reservationId);
  const statusAfterApproval = finalTxRecord ? finalTxRecord.status : "RECORD_MISSING";
  console.log(`  - Final ledger entry status: ${statusAfterApproval}`);

  const assertReconciled = statusAfterApproval === "RECONCILED";

  const passed = assertPaused && assertStillPending && assertInPendingQueue && assertApproveSuccess && assertReconciled;
  console.log(`Outcome: ${passed ? "PASSED" : "FAILED"}`);
  return passed;
}
