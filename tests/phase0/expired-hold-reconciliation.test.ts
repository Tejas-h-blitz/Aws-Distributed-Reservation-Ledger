import { strict as assert } from "node:assert";
import { reconcileEvent } from "../../src/handlers/reconciliation";
import { MemoryHoldRepository } from "../../src/repository/hold.memory";
import { MemoryInventoryRepository } from "../../src/repository/inventory.memory";
import { MemoryLedgerRepository } from "../../src/repository/ledger.memory";
import { setRegistry, ServiceRegistry } from "../../src/registry";
import { MemoryIdempotencyStore } from "../../src/utils/idempotency";

async function run(): Promise<void> {
  process.env.LOCAL_TESTING = "true";
  const eventId = "phase0-expiry-event";
  const inventory = new MemoryInventoryRepository();
  const fallbackInventory = new MemoryInventoryRepository();
  const registry: ServiceRegistry = {
    inventory,
    fallbackInventory,
    holds: new MemoryHoldRepository(),
    ledger: new MemoryLedgerRepository(),
    idempotency: new MemoryIdempotencyStore(),
  };
  setRegistry(registry);

  await inventory.setStock(eventId, 0);
  await fallbackInventory.setStock(eventId, 0);
  await registry.holds.createHold({
    HoldID: "phase0-expired-hold",
    EventID: eventId,
    UserID: "phase0-user",
    ExpirationTimestamp: Math.floor(Date.now() / 1000) - 1,
    Status: "PENDING",
  });

  await reconcileEvent(eventId, 1);

  assert.equal(
    await inventory.getCurrentStock(eventId),
    1,
    "an expired pending hold must not consume available inventory"
  );
  assert.equal(
    await fallbackInventory.getCurrentStock(eventId),
    1,
    "expiry reconciliation must also repair the fallback inventory count"
  );
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
