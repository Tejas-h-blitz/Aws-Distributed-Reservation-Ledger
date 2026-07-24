import { CircuitBreaker } from "../utils/circuit-breaker";
import { logger } from "../utils/logger";
 
// Global singleton instance for local integration tests
export const paymentCircuitBreaker = new CircuitBreaker(0.5, 10000, 3000, 4);
 
/**
 * Core payment processing function protected by the Circuit Breaker.
 */
export async function processPayment(reservationId: string, amount: number): Promise<{ success: boolean; transactionId: string }> {
  return await paymentCircuitBreaker.execute(async () => {
    // Deterministic failure condition for testing
    if (reservationId.toLowerCase().includes("fail")) {
      throw new Error("Payment gateway connection timeout (simulated force failure).");
    }
 
    // 20% Failure rate injection
    if (Math.random() < 0.2) {
      throw new Error("Payment gateway connection timeout (simulated).");
    }
 
    // Variable API Latency (10ms - 100ms)
    const delay = Math.floor(Math.random() * 90) + 10;
    await new Promise(resolve => setTimeout(resolve, delay));
 
    return {
      success: true,
      transactionId: `pay_tx_${Math.random().toString(36).substring(2, 11)}`,
    };
  });
}
 
/**
 * AWS Lambda handler for Saga Step Functions invocation.
 */
export async function handler(event: any): Promise<any> {
  const { ReservationID, Amount } = event;
  if (!ReservationID || !Amount) {
    logger.warn("Payment processor invoked with missing parameters", { event });
    return {
      success: false,
      error: "Missing parameters 'ReservationID' or 'Amount' in saga input.",
    };
  }
 
  try {
    logger.info("Invoking payment gateway", { ReservationID, Amount });
    const paymentResult = await processPayment(ReservationID, Amount);
    logger.info("Payment captured successfully", { ReservationID, transactionId: paymentResult.transactionId });
    return paymentResult;
  } catch (error: any) {
    logger.error(`Payment execution failed. Error: ${error.message}`, error, { ReservationID });
    return {
      success: false,
      error: error.message,
    };
  }
}
