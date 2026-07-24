export interface HoldRecord {
  HoldID: string;
  EventID: string;
  UserID: string;
  ExpirationTimestamp: number; // epoch timestamp in seconds
  Status: "PENDING" | "SETTLED" | "CANCELLED";
  Version: number; // for OCC
}

export interface HoldRepository {
  createHold(hold: Omit<HoldRecord, "Version">): Promise<void>; // Conditional put attribute_not_exists(HoldID)
  getHold(holdId: string): Promise<HoldRecord | null>;
  updateHoldStatus(holdId: string, status: HoldRecord["Status"], expectedVersion: number): Promise<void>;
  deleteHold(holdId: string): Promise<void>;
  getHoldsByEventId(eventId: string): Promise<HoldRecord[]>;
  getAllHolds(): Promise<HoldRecord[]>;
}
