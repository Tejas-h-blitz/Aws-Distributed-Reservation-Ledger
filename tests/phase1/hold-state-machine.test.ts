import { strict as assert } from "node:assert";
import {
  HoldStateMachine,
  InvalidHoldTransitionError,
} from "../../src/repository/hold-state-machine";
import { HoldStatus } from "../../src/repository/hold.interface";
import { MemoryHoldRepository } from "../../src/repository/hold.memory";

const statuses: HoldStatus[] = [
  "PENDING",
  "SETTLED",
  "CANCELLED",
  "EXPIRED",
  "COMPENSATED",
];

async function createHold(
  repository: MemoryHoldRepository,
  holdId: string,
  status: HoldStatus
): Promise<void> {
  await repository.createHold({
    HoldID: holdId,
    EventID: "phase1-event",
    UserID: "phase1-user",
    ExpirationTimestamp: Math.floor(Date.now() / 1000) + 600,
    Status: status,
  });
}

async function run(): Promise<void> {
  for (const from of statuses) {
    for (const to of statuses) {
      const repository = new MemoryHoldRepository();
      const holdId = `phase1-${from}-${to}`;
      await createHold(repository, holdId, from);
      const stateMachine = new HoldStateMachine(repository);
      const allowed =
        from === to ||
        (from === "PENDING" &&
          ["SETTLED", "CANCELLED", "EXPIRED", "COMPENSATED"].includes(to));

      if (allowed) {
        const changed = await stateMachine.transition(holdId, to);
        const hold = await repository.getHold(holdId);
        assert.equal(hold?.Status, to);
        assert.equal(changed, from !== to);
      } else {
        await assert.rejects(
          stateMachine.transition(holdId, to),
          (error: unknown) =>
            error instanceof InvalidHoldTransitionError &&
            error.holdId === holdId &&
            error.from === from &&
            error.to === to
        );
        const hold = await repository.getHold(holdId);
        assert.equal(hold?.Status, from);
      }
    }
  }

  const missingRepository = new MemoryHoldRepository();
  await assert.rejects(
    new HoldStateMachine(missingRepository).transition("missing", "SETTLED"),
    /was not found/
  );

  console.log("Hold state-machine transition matrix PASSED.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
