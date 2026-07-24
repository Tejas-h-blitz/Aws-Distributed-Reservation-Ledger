export interface InventoryRepository {
  decrementStock(eventId: string): Promise<boolean>; // Returns true if stock was successfully decremented, false if out of stock
  incrementStock(eventId: string): Promise<void>;
  getCurrentStock(eventId: string): Promise<number>;
  setStock(eventId: string, count: number): Promise<void>;
}
