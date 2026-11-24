import { HoldRepository, HoldStatus } from "./hold.interface";

export class InvalidHoldTransitionError extends Error {
  constructor(
    public readonly holdId: string,
    public readonly from: HoldStatus,
    public readonly to: HoldStatus
  ) {
    super(`Invalid hold transition ${from} -> ${to} for hold ${holdId}`);
    this.name = "InvalidHoldTransitionError";
  }
}

export class HoldStateMachine {
  private static readonly allowedTransitions: Readonly<
    Record<HoldStatus, ReadonlySet<HoldStatus>>
  > = {
    PENDING: new Set(["PENDING", "SETTLED", "CANCELLED", "EXPIRED", "COMPENSATED"]),
    SETTLED: new Set(["SETTLED"]),
    CANCELLED: new Set(["CANCELLED"]),
    EXPIRED: new Set(["EXPIRED"]),
    COMPENSATED: new Set(["COMPENSATED"]),
  };

  constructor(private readonly holds: HoldRepository) {}

  async transition(holdId: string, targetStatus: HoldStatus): Promise<boolean> {
    const hold = await this.holds.getHold(holdId);
    if (!hold) {
      throw new Error(`Hold ${holdId} was not found`);
    }

    if (!HoldStateMachine.allowedTransitions[hold.Status].has(targetStatus)) {
      throw new InvalidHoldTransitionError(holdId, hold.Status, targetStatus);
    }

    if (hold.Status === targetStatus) {
      return false;
    }

    await this.holds.updateHoldStatus(holdId, targetStatus, hold.Version);
    return true;
  }
}
