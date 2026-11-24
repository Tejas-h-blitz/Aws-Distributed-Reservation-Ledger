import { strict as assert } from "node:assert";
import { handler as compensate } from "../../src/handlers/compensate";
import { MemoryHoldRepository } from "../../src/repository/hold.memory";
import { MemoryInventoryRepository } from "../../src/repository/inventory.memory";
import { MemoryLedgerRepository } from "../../src/repository/ledger.memory";
import { setRegistry, ServiceRegistry } from "../../src/registry";
import { MemoryIdempotencyStore } from "../../src/utils/idempotency";

async function run(): Promise<void> {
  process.env.LOCAL_TESTING = "true";
  const eventId = "phase0-compensation-event";
  const holdId = "phase0-compensation-hold";
  const inventory = new MemoryInventoryRepository();
  const registry: ServiceRegistry = {
    inventory,
    fallbackInventory: new MemoryInventoryRepository(),
    holds: new MemoryHoldRepository(),
    ledger: new MemoryLedgerRepository(),
    idempotency: new MemoryIdempotencyStore(),
  };
  setRegistry(registry);

  await inventory.setStock(eventId, 0);
  await registry.holds.createHold({
    HoldID: holdId,
    EventID: eventId,
    UserID: "phase0-user",
    ExpirationTimestamp: Math.floor(Date.now() / 1000) + 600,
    Status: "PENDING",
  });

  const event = { ReservationID: holdId, EventID: eventId, UsedFallbackStore: false };
  await compensate(event);
  await compensate(event);

  assert.equal(
    await inventory.getCurrentStock(eventId),
    1,
    "replaying compensation must not return the same inventory unit twice"
  );
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
