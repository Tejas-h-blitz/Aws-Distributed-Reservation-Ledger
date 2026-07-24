import { getRegistry } from "../registry";
import { logger } from "../utils/logger";
 
/**
 * AWS Lambda handler to execute compensating transaction on payment failures.
 * Sets hold record status to CANCELLED and returns stock to the appropriate inventory store.
 */
export async function handler(event: any): Promise<any> {
  const { ReservationID, EventID, UsedFallbackStore } = event;
  if (!ReservationID || !EventID) {
    logger.warn("Compensation handler invoked with missing parameters", { event });
    return {
      success: false,
      error: "Missing required parameters 'ReservationID' or 'EventID' for compensation.",
    };
  }
 
  const registry = getRegistry();
 
  try {
    logger.info("Executing saga compensation: cancelling hold record", { ReservationID, EventID });
    // 1. Mark hold status as CANCELLED in DynamoDB
    const hold = await registry.holds.getHold(ReservationID);
    if (hold) {
      await registry.holds.updateHoldStatus(ReservationID, "CANCELLED", hold.Version);
    } else {
      logger.warn(`ActiveHold record with ID ${ReservationID} not found. Proceeding with counter return.`, { ReservationID });
    }
 
    // 2. Increment stock counter back on appropriate store
    if (UsedFallbackStore) {
      await registry.fallbackInventory.incrementStock(EventID);
      logger.info(`Reverted fallback DynamoDB counter for EventID`, { EventID, ReservationID });
    } else {
      try {
        await registry.inventory.incrementStock(EventID);
        logger.info(`Reverted primary Redis counter for EventID`, { EventID, ReservationID });
      } catch (redisError: any) {
        // If Redis failed during saga execution, fall back to incrementing the DynamoDB counter
        logger.warn(`Redis unreachable during compensation. Reverting counter on DynamoDB instead. Error: ${redisError.message}`, { EventID, ReservationID });
        await registry.fallbackInventory.incrementStock(EventID);
      }
    }
 
    return {
      success: true,
      message: `Compensating transaction completed. Reservation ${ReservationID} cancelled and inventory returned.`,
    };
  } catch (error: any) {
    logger.error(`Compensation process failed. Error: ${error.message}`, error, { ReservationID });
    return {
      success: false,
      error: error.message,
    };
  }
}
