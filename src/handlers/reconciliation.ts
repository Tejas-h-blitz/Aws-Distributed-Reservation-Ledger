import { getRegistry } from "../registry";

/**
 * Reconciles stock drift for a specific event.
 * Computes: ExpectedStock = TotalCapacity - ConfirmedActiveHolds
 * Adjusts Redis and DynamoDB counter stores to match expected stock.
 */
export async function reconcileEvent(eventId: string, totalCapacity: number): Promise<{ reconciled: boolean; adjustedBy: number }> {
  const registry = getRegistry();

  // 1. Get confirmed holds from DynamoDB
  const holds = await registry.holds.getHoldsByEventId(eventId);
  const activeHolds = holds.filter(h => h.Status === "PENDING" || h.Status === "SETTLED");
  const activeHoldsCount = activeHolds.length;

  // 2. Compute expected stock level
  const expectedStock = Math.max(0, totalCapacity - activeHoldsCount);

  // 3. Query current Redis stock level
  let currentRedisStock = -1;
  try {
    currentRedisStock = await registry.inventory.getCurrentStock(eventId);
  } catch (err) {
    console.warn(`[Reconciliation] Redis is offline. Skipping Redis counter update for event: ${eventId}`);
  }

  // 4. Update stores if drift is detected
  let reconciled = false;
  let adjustedBy = 0;

  if (currentRedisStock !== -1) {
    const drift = expectedStock - currentRedisStock;
    if (drift !== 0) {
      console.log(`[Reconciliation] Drift detected for event ${eventId}. Expected Redis stock: ${expectedStock}, Live Redis stock: ${currentRedisStock}. Drift: ${drift}. Repairing...`);
      await registry.inventory.setStock(eventId, expectedStock);
      reconciled = true;
      adjustedBy = drift;
    }
  } else {
    // If Redis is online but counter is missing, initialize it
    try {
      console.log(`[Reconciliation] Seeding Redis counter for event ${eventId} to expected value: ${expectedStock}`);
      await registry.inventory.setStock(eventId, expectedStock);
      reconciled = true;
      adjustedBy = expectedStock;
    } catch {
      // Redis is offline, continue to fallback store
    }
  }

  // Always reconcile the fallback DynamoDB counter store
  const currentDynamoStock = await registry.fallbackInventory.getCurrentStock(eventId);
  if (currentDynamoStock !== expectedStock) {
    console.log(`[Reconciliation] Fallback DynamoDB counter drift detected for event ${eventId}. Expected: ${expectedStock}, Current: ${currentDynamoStock}. Repairing...`);
    await registry.fallbackInventory.setStock(eventId, expectedStock);
    reconciled = true;
    adjustedBy = expectedStock - currentDynamoStock;
  }

  return { reconciled, adjustedBy };
}

/**
 * AWS Lambda handler scheduled via EventBridge.
 */
export async function handler(event: any): Promise<any> {
  const { EventID, TotalCapacity } = event;
  if (!EventID || !TotalCapacity) {
    return {
      success: false,
      error: "Missing parameters 'EventID' or 'TotalCapacity' in event payload.",
    };
  }

  try {
    const reconciliationResult = await reconcileEvent(EventID, TotalCapacity);
    return {
      success: true,
      ...reconciliationResult,
    };
  } catch (error: any) {
    console.error(`[Reconciliation] Process failed for EventID ${EventID}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}
