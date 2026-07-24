"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentCircuitBreaker = void 0;
exports.processPayment = processPayment;
exports.handler = handler;
const circuit_breaker_1 = require("../utils/circuit-breaker");
// Global singleton instance for local integration tests
exports.paymentCircuitBreaker = new circuit_breaker_1.CircuitBreaker(0.5, 10000, 3000, 4);
/**
 * Core payment processing function protected by the Circuit Breaker.
 */
async function processPayment(reservationId, amount) {
    return await exports.paymentCircuitBreaker.execute(async () => {
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
async function handler(event) {
    const { ReservationID, Amount } = event;
    if (!ReservationID || !Amount) {
        return {
            success: false,
            error: "Missing parameters 'ReservationID' or 'Amount' in saga input.",
        };
    }
    try {
        const paymentResult = await processPayment(ReservationID, Amount);
        return paymentResult;
    }
    catch (error) {
        return {
            success: false,
            error: error.message,
        };
    }
}
