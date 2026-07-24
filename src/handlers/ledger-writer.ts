import { getRegistry } from "../registry";
import { executeWithRetry } from "../utils/backoff";
import { logger } from "../utils/logger";
 
/**
 * AWS Lambda handler to settle the ledger entry and mark holds as SETTLED.
 */
export async function handler(event: any): Promise<any> {
  const { ReservationID, UserID, Amount, Currency, TransactionID } = event;
  if (!ReservationID || !UserID || !Amount) {
    logger.warn("Ledger writer invoked with missing parameters", { event });
    return {
      success: false,
      error: "Missing required attributes 'ReservationID', 'UserID' or 'Amount' in event payload.",
    };
  }
 
  const registry = getRegistry();
 
  try {
    logger.info("Ledger writer recording transaction to SQL database", { ReservationID, UserID, Amount });
    // 1. Record transaction in PostgreSQL ledger
    await registry.ledger.createTransaction({
      reservation_id: ReservationID,
      user_id: UserID,
      amount: Amount,
      currency: Currency || "USD",
      account_debited: `acct_user_${UserID}`,
      account_credited: "acct_escrow_merchant",
      status: "PENDING", // Initiated as pending audit reconciliation
    });
 
    logger.info("Transitioning ActiveHolds status to SETTLED with OCC retry", { ReservationID });
    // 2. Transition DynamoDB hold to SETTLED (Retry if version mismatch / OCC error occurs)
    await executeWithRetry(
      async () => {
        const hold = await registry.holds.getHold(ReservationID);
        if (!hold) {
          throw new Error(`ActiveHold record with ID ${ReservationID} not found.`);
        }
        
        await registry.holds.updateHoldStatus(ReservationID, "SETTLED", hold.Version);
      },
      3,   // 3 attempts
      100, // 100ms base delay
      1000 // 1000ms cap
    );
 
    logger.info(`Settle transaction completed successfully`, { ReservationID });
    return {
      success: true,
      message: `Transaction settled successfully. reservation_id=${ReservationID}`,
    };
  } catch (error: any) {
    logger.error(`Failed to process ledger write. Error: ${error.message}`, error, { ReservationID });
    return {
      success: false,
      error: error.message,
    };
  }
}
