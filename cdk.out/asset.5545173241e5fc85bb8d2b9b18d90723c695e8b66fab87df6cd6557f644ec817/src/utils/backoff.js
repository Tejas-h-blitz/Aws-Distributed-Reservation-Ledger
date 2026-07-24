"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = sleep;
exports.calculateBackoff = calculateBackoff;
exports.executeWithRetry = executeWithRetry;
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Calculates exponential backoff with jitter:
 * sleep = random(0, min(cap, base * 2^attempt))
 */
function calculateBackoff(attempt, base = 100, cap = 5000) {
    const maxBackoff = Math.min(cap, base * Math.pow(2, attempt));
    // random(0, maxBackoff)
    return Math.floor(Math.random() * maxBackoff);
}
/**
 * Executes a function with exponential backoff and jitter retry logic.
 */
async function executeWithRetry(fn, maxAttempts = 3, base = 100, cap = 5000, onRetry) {
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        }
        catch (error) {
            attempt++;
            if (attempt >= maxAttempts) {
                throw error;
            }
            const delay = calculateBackoff(attempt, base, cap);
            if (onRetry) {
                onRetry(error, attempt, delay);
            }
            await sleep(delay);
        }
    }
}
