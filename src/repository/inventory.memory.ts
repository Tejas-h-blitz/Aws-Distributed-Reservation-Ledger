import { InventoryRepository } from "./inventory.interface";

export class MemoryInventoryRepository implements InventoryRepository {
  private stockMap = new Map<string, number>();
  private isUnreachable = false;

  public setUnreachable(status: boolean) {
    this.isUnreachable = status;
  }

  async decrementStock(eventId: string): Promise<boolean> {
    if (this.isUnreachable) {
      throw new Error("Redis connection failure (simulated).");
    }
    const current = this.stockMap.get(eventId) ?? -1;
    if (current === -1) {
      throw new Error(`Inventory key inventory:${eventId} is not initialized in Redis.`);
    }
    if (current > 0) {
      this.stockMap.set(eventId, current - 1);
      return true;
    }
    return false;
  }

  async incrementStock(eventId: string): Promise<void> {
    if (this.isUnreachable) {
      throw new Error("Redis connection failure (simulated).");
    }
    const current = this.stockMap.get(eventId) ?? -1;
    if (current !== -1) {
      this.stockMap.set(eventId, current + 1);
    }
  }

  async getCurrentStock(eventId: string): Promise<number> {
    if (this.isUnreachable) {
      throw new Error("Redis connection failure (simulated).");
    }
    return this.stockMap.get(eventId) ?? -1;
  }

  async setStock(eventId: string, count: number): Promise<void> {
    if (this.isUnreachable) {
      throw new Error("Redis connection failure (simulated).");
    }
    this.stockMap.set(eventId, count);
  }
}
