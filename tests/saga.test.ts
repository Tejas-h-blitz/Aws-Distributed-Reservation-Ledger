import { getRegistry } from "../src/registry";

/**
 * Saga Compensation Test
 * Asserts that when a payment gateway failure occurs, the Step Functions Saga
 * triggers compensation: returning stock to the counter and marking the hold CANCELLED.
 */
export async function runSagaTest(baseUrl: string): Promise<boolean> {
  console.log("\n=== 4. Saga Compensation Test ===");
  const eventId = "evt_saga_compensate_test";
  const holdId = "hold_fail_payment_saga_999"; // Contains "fail" to force payment failure

  // Seed stock level to 1
  await fetch(`${baseUrl}/inventory/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId, count: 1 }),
  });

  // 1. Submit reservation request (Accepted synchronously)
  console.log("Triggering reservation with forced payment failure reservation ID...");
  const res = await fetch(`${baseUrl}/reserve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "key_saga_failure_999",
    },
    body: JSON.stringify({
      EventID: eventId,
      UserID: "user_compensating_consumer",
      HoldID: holdId,
    }),
  });

  const holdData = await res.json() as any;
  console.log(`  - Reservation Response: HTTP ${res.status}, Status=${holdData.Status}`);

  const assertSyncSuccess = res.status === 202;

  // 2. Wait for background Step Functions to execute payment and trigger compensation
  console.log("Waiting for background Saga execution and compensation tasks to complete...");
  await new Promise(resolve => setTimeout(resolve, 300));

  // 3. Verify final state
  const registry = getRegistry();
  const holdRecord = await registry.holds.getHold(holdId);
  const finalStatus = holdRecord ? holdRecord.Status : "RECORD_MISSING";
  console.log(`  - Final hold record status in DynamoDB: ${finalStatus}`);

  const assertCancelled = finalStatus === "CANCELLED";

  // Check ledger database
  const ledgerRes = await fetch(`${baseUrl}/ledger`);
  const ledger = await ledgerRes.json() as any;
  const txInLedger = ledger.some((tx: any) => tx.reservation_id === holdId);
  console.log(`  - Ledger transaction written: ${txInLedger}`);

  const assertNoLedgerTx = !txInLedger;

  // Check final stock reverted to 1
  const stockRes = await fetch(`${baseUrl}/inventory/${eventId}`);
  const stockData = await stockRes.json() as any;
  console.log(`  - Final stock counters: Redis=${stockData.RedisStock}, DynamoDB=${stockData.DynamoDBStock}`);

  const assertStockReverted = stockData.DynamoDBStock === 1;

  const passed = assertSyncSuccess && assertCancelled && assertNoLedgerTx && assertStockReverted;
  console.log(`Outcome: ${passed ? "PASSED" : "FAILED"}`);
  return passed;
}
