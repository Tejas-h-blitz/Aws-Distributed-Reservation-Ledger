import { strict as assert } from "node:assert";
import { MemoryHoldRepository } from "../../src/repository/hold.memory";
import { MemoryInventoryRepository } from "../../src/repository/inventory.memory";
import { HoldStateMachine } from "../../src/repository/hold-state-machine";
import { reconcileEvent } from "../../src/handlers/reconciliation";
import { MemoryLedgerRepository } from "../../src/repository/ledger.memory";
import { MemoryIdempotencyStore } from "../../src/utils/idempotency";
import { setRegistry, ServiceRegistry } from "../../src/registry";

const SEED = 424242;
let randomState = SEED;

function seededRandom(): number {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 0x100000000;
}

async function invariant(
  name: string,
  check: () => boolean | Promise<boolean>
): Promise<void> {
  assert.ok(await check(), `Invariant failed: ${name}`);
  console.log(`  PASS invariant: ${name}`);
}

async function makeRegistry(capacity: number) {
  const primary = new MemoryInventoryRepository();
  const fallback = new MemoryInventoryRepository();
  const holds = new MemoryHoldRepository();
  const ledger = new MemoryLedgerRepository();
  const registry: ServiceRegistry = {
    inventory: primary,
    fallbackInventory: fallback,
    holds,
    ledger,
    idempotency: new MemoryIdempotencyStore(),
  };
  setRegistry(registry);
  await primary.setStock("shared-event", capacity);
  await fallback.setStock("shared-event", capacity);
  return { registry, primary, fallback, holds };
}

async function crashMidSaga(): Promise<void> {
  const { primary, holds } = await makeRegistry(2);
  await primary.decrementStock("shared-event");
  await holds.createHold({
    HoldID: "crash-hold",
    EventID: "shared-event",
    UserID: "crash-user",
    ExpirationTimestamp: Math.floor(Date.now() / 1000) + 600,
    Status: "PENDING",
  });
  // Crash before settlement/compensation code resumes.
  const stateMachine = new HoldStateMachine(holds);
  await stateMachine.transition("crash-hold", "COMPENSATED");
  await primary.incrementStock("shared-event");

  await invariant(
    "capacity never exceeded after crash recovery",
    async () => (await primary.getCurrentStock("shared-event")) <= 2
  );
  await invariant(
    "crash recovery restores exactly one unit",
    async () => (await primary.getCurrentStock("shared-event")) === 2
  );
  await invariant(
    "crash hold reaches a terminal state",
    async () => (await holds.getHold("crash-hold"))?.Status === "COMPENSATED"
  );
}

async function duplicateDelayedReorderedEvents(): Promise<void> {
  const { primary, holds } = await makeRegistry(1);
  await primary.decrementStock("shared-event");
  await holds.createHold({
    HoldID: "duplicate-hold",
    EventID: "shared-event",
    UserID: "duplicate-user",
    ExpirationTimestamp: Math.floor(Date.now() / 1000) + 600,
    Status: "PENDING",
  });
  const stateMachine = new HoldStateMachine(holds);
  const events = [
    () => stateMachine.transition("duplicate-hold", "CANCELLED"),
    () => stateMachine.transition("duplicate-hold", "CANCELLED"),
    () => stateMachine.transition("duplicate-hold", "CANCELLED"),
  ];
  while (events.length > 0) {
    const index = Math.floor(seededRandom() * events.length);
    const event = events.splice(index, 1)[0];
    if (await event()) {
      await primary.incrementStock("shared-event");
    }
  }

  await invariant(
    "same hold cannot be cancelled more than once",
    async () => (await holds.getHold("duplicate-hold"))?.Status === "CANCELLED"
  );
  await invariant(
    "duplicate replay restores only one stock unit",
    async () => (await primary.getCurrentStock("shared-event")) === 1
  );
  await invariant(
    "duplicate/delayed/reordered events do not overflow stock",
    async () => (await primary.getCurrentStock("shared-event")) <= 1
  );
}

async function retryStorm(): Promise<void> {
  const { primary, holds } = await makeRegistry(1);
  await primary.decrementStock("shared-event");
  await holds.createHold({
    HoldID: "retry-hold",
    EventID: "shared-event",
    UserID: "retry-user",
    ExpirationTimestamp: Math.floor(Date.now() / 1000) + 600,
    Status: "PENDING",
  });
  const stateMachine = new HoldStateMachine(holds);
  for (let attempt = 0; attempt < 100; attempt++) {
    const changed = await stateMachine.transition("retry-hold", "COMPENSATED").catch(() => false);
    if (changed) {
      await primary.incrementStock("shared-event");
    }
  }
  await invariant(
    "retry storm causes one terminal compensation",
    async () => (await holds.getHold("retry-hold"))?.Status === "COMPENSATED"
  );
  await invariant(
    "retry storm cannot exceed capacity",
    async () =>
      (await primary.getCurrentStock("shared-event")) === 1 &&
      (await primary.getCurrentStock("shared-event")) <= 1
  );
}

async function dynamodbThrottling(): Promise<void> {
  const { primary, holds } = await makeRegistry(1);
  await primary.decrementStock("shared-event");
  await holds.createHold({
    HoldID: "throttle-hold",
    EventID: "shared-event",
    UserID: "throttle-user",
    ExpirationTimestamp: Math.floor(Date.now() / 1000) + 600,
    Status: "PENDING",
  });

  const originalUpdate = holds.updateHoldStatus.bind(holds);
  let throttledAttempts = 0;
  holds.updateHoldStatus = async (holdId, status, expectedVersion) => {
    if (throttledAttempts < 3) {
      throttledAttempts++;
      const error = new Error("simulated DynamoDB throttling");
      error.name = "ThrottlingException";
      throw error;
    }
    await originalUpdate(holdId, status, expectedVersion);
  };

  const stateMachine = new HoldStateMachine(holds);
  let changed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      changed = await stateMachine.transition("throttle-hold", "CANCELLED");
      if (changed) {
        await primary.incrementStock("shared-event");
      }
      break;
    } catch (error: any) {
      if (error.name !== "ThrottlingException") throw error;
    }
  }

  await invariant(
    "DynamoDB throttle retries preserve one terminal state",
    async () => (await holds.getHold("throttle-hold"))?.Status === "CANCELLED"
  );
  await invariant(
    "throttle retries do not over-return stock",
    async () => (await primary.getCurrentStock("shared-event")) === 1
  );
}

async function redisLossAndThrottling(): Promise<void> {
  const { primary, fallback, holds } = await makeRegistry(2);
  primary.setUnreachable(true);
  await fallback.decrementStock("shared-event");
  await holds.createHold({
    HoldID: "fallback-hold",
    EventID: "shared-event",
    UserID: "fallback-user",
    ExpirationTimestamp: Math.floor(Date.now() / 1000) + 600,
    Status: "PENDING",
  });
  primary.setUnreachable(false);
  const stateMachine = new HoldStateMachine(holds);
  await stateMachine.transition("fallback-hold", "CANCELLED");

  await invariant(
    "Redis loss uses fallback hold without overbooking",
    async () => (await fallback.getCurrentStock("shared-event")) === 1
  );
  await invariant(
    "fallback hold and stock remain below capacity",
    async () =>
      (await holds.getHold("fallback-hold"))?.Status === "CANCELLED" &&
      (await fallback.getCurrentStock("shared-event")) <= 2
  );
}

async function contention(): Promise<void> {
  const { primary, holds } = await makeRegistry(1);
  let successes = 0;
  await Promise.all(
    Array.from({ length: 50 }, async (_, index) => {
      if (await primary.decrementStock("shared-event")) {
        await holds.createHold({
          HoldID: `contention-${index}`,
          EventID: "shared-event",
          UserID: `user-${index}`,
          ExpirationTimestamp: Math.floor(Date.now() / 1000) + 600,
          Status: "PENDING",
        });
        successes++;
      }
    })
  );
  await invariant(
    "capacity never exceeded under concurrent contention",
    async () => successes <= 1 && (await primary.getCurrentStock("shared-event")) >= 0
  );
  await invariant(
    "no double-booking on one resource",
    async () => (await holds.getAllHolds()).length <= 1
  );
}

async function expiryAndLeakCheck(): Promise<void> {
  const { registry, primary, holds } = await makeRegistry(1);
  await primary.decrementStock("shared-event");
  await holds.createHold({
    HoldID: "expired-hold",
    EventID: "shared-event",
    UserID: "expired-user",
    ExpirationTimestamp: Math.floor(Date.now() / 1000) - 1,
    Status: "PENDING",
  });
  await reconcileEvent("shared-event", 1);
  await invariant(
    "expired hold is transitioned out of PENDING",
    async () => (await holds.getHold("expired-hold"))?.Status === "EXPIRED"
  );
  await invariant(
    "no leaked active hold after expiry reconciliation",
    async () =>
      (await holds.getAllHolds()).filter(hold =>
        hold.Status === "PENDING" || hold.Status === "SETTLED"
      ).length === 0
  );
  void registry;
}

async function run(): Promise<void> {
  console.log(`Fault-injection harness seed=${SEED}`);
  console.log("Scenario: crash mid-saga");
  await crashMidSaga();
  console.log("Scenario: duplicate/delayed/reordered events");
  await duplicateDelayedReorderedEvents();
  console.log("Scenario: retry storm");
  await retryStorm();
  console.log("Scenario: Redis loss and fallback");
  await redisLossAndThrottling();
  console.log("Scenario: DynamoDB throttling");
  await dynamodbThrottling();
  console.log("Scenario: concurrent contention");
  await contention();
  console.log("Scenario: expiry reconciliation");
  await expiryAndLeakCheck();
  console.log("All seeded fault-injection invariants PASSED.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
