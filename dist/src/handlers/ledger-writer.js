"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const registry_1 = require("../registry");
const backoff_1 = require("../utils/backoff");
/**
 * AWS Lambda handler to settle the ledger entry and mark holds as SETTLED.
 */
async function handler(event) {
    const { ReservationID, UserID, Amount, Currency, TransactionID } = event;
    if (!ReservationID || !UserID || !Amount) {
        return {
            success: false,
            error: "Missing required attributes 'ReservationID', 'UserID' or 'Amount' in event payload.",
        };
    }
    const registry = (0, registry_1.getRegistry)();
    try {
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
        // 2. Transition DynamoDB hold to SETTLED (Retry if version mismatch / OCC error occurs)
        await (0, backoff_1.executeWithRetry)(async () => {
            const hold = await registry.holds.getHold(ReservationID);
            if (!hold) {
                throw new Error(`ActiveHold record with ID ${ReservationID} not found.`);
            }
            await registry.holds.updateHoldStatus(ReservationID, "SETTLED", hold.Version);
        }, 3, // 3 attempts
        100, // 100ms base delay
        1000 // 1000ms cap
        );
        console.log(`[LedgerWriter] Settle transaction completed successfully for ReservationID: ${ReservationID}`);
        return {
            success: true,
            message: `Transaction settled successfully. reservation_id=${ReservationID}`,
        };
    }
    catch (error) {
        console.error(`[LedgerWriter] Failed to process ledger write for ReservationID: ${ReservationID}. Error:`, error);
        return {
            success: false,
            error: error.message,
        };
    }
}
