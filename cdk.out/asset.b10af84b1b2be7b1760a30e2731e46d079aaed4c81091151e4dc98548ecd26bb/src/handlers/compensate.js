"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const registry_1 = require("../registry");
/**
 * AWS Lambda handler to execute compensating transaction on payment failures.
 * Sets hold record status to CANCELLED and returns stock to the appropriate inventory store.
 */
async function handler(event) {
    const { ReservationID, EventID, UsedFallbackStore } = event;
    if (!ReservationID || !EventID) {
        return {
            success: false,
            error: "Missing required parameters 'ReservationID' or 'EventID' for compensation.",
        };
    }
    const registry = (0, registry_1.getRegistry)();
    try {
        // 1. Mark hold status as CANCELLED in DynamoDB
        const hold = await registry.holds.getHold(ReservationID);
        if (hold) {
            await registry.holds.updateHoldStatus(ReservationID, "CANCELLED", hold.Version);
        }
        else {
            console.warn(`[Compensate] ActiveHold record with ID ${ReservationID} not found. Proceeding with counter return.`);
        }
        // 2. Increment stock counter back on appropriate store
        if (UsedFallbackStore) {
            await registry.fallbackInventory.incrementStock(EventID);
            console.log(`[Compensate] Reverted fallback DynamoDB counter for EventID: ${EventID}`);
        }
        else {
            try {
                await registry.inventory.incrementStock(EventID);
                console.log(`[Compensate] Reverted primary Redis counter for EventID: ${EventID}`);
            }
            catch (redisError) {
                // If Redis failed during saga execution, fall back to incrementing the DynamoDB counter
                console.warn(`[Compensate] Redis unreachable during compensation. Reverting counter on DynamoDB instead.`, redisError);
                await registry.fallbackInventory.incrementStock(EventID);
            }
        }
        return {
            success: true,
            message: `Compensating transaction completed. Reservation ${ReservationID} cancelled and inventory returned.`,
        };
    }
    catch (error) {
        console.error(`[Compensate] Compensation process failed for ReservationID: ${ReservationID}:`, error);
        return {
            success: false,
            error: error.message,
        };
    }
}
