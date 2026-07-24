import { HoldRepository, HoldRecord } from "./hold.interface";

export class MemoryHoldRepository implements HoldRepository {
  private holds = new Map<string, HoldRecord>();

  async createHold(hold: Omit<HoldRecord, "Version">): Promise<void> {
    if (this.holds.has(hold.HoldID)) {
      const err = new Error("The conditional request failed: HoldID already exists.");
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
    this.holds.set(hold.HoldID, {
      ...hold,
      Version: 1,
    });
  }

  async getHold(holdId: string): Promise<HoldRecord | null> {
    return this.holds.get(holdId) || null;
  }

  async updateHoldStatus(holdId: string, status: HoldRecord["Status"], expectedVersion: number): Promise<void> {
    const hold = this.holds.get(holdId);
    if (!hold) {
      throw new Error("Transaction hold record not found.");
    }
    if (hold.Version !== expectedVersion) {
      const err = new Error("The conditional request failed: Version mismatch (OCC failure).");
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
    hold.Status = status;
    hold.Version += 1;
    this.holds.set(holdId, hold);
  }

  async deleteHold(holdId: string): Promise<void> {
    this.holds.delete(holdId);
  }

  async getHoldsByEventId(eventId: string): Promise<HoldRecord[]> {
    return Array.from(this.holds.values()).filter(h => h.EventID === eventId);
  }

  async getAllHolds(): Promise<HoldRecord[]> {
    return Array.from(this.holds.values());
  }
}
