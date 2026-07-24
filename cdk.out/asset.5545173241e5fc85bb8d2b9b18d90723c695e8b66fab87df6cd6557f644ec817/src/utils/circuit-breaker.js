"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = exports.CircuitState = void 0;
var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "CLOSED";
    CircuitState["OPEN"] = "OPEN";
    CircuitState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitState || (exports.CircuitState = CircuitState = {}));
class CircuitBreaker {
    failureRateThreshold;
    windowMs;
    resetTimeoutMs;
    minRequests;
    state = CircuitState.CLOSED;
    lastStateChange = Date.now();
    requestHistory = [];
    constructor(failureRateThreshold = 0.5, windowMs = 10000, resetTimeoutMs = 5000, minRequests = 4 // Minimum requests in window before evaluating
    ) {
        this.failureRateThreshold = failureRateThreshold;
        this.windowMs = windowMs;
        this.resetTimeoutMs = resetTimeoutMs;
        this.minRequests = minRequests;
    }
    getState() {
        this.updateState();
        return this.state;
    }
    updateState() {
        const now = Date.now();
        if (this.state === CircuitState.OPEN) {
            if (now - this.lastStateChange > this.resetTimeoutMs) {
                this.transitionTo(CircuitState.HALF_OPEN);
            }
        }
    }
    transitionTo(newState) {
        this.state = newState;
        this.lastStateChange = Date.now();
        if (newState === CircuitState.CLOSED) {
            this.requestHistory = [];
        }
    }
    async execute(fn) {
        this.updateState();
        if (this.state === CircuitState.OPEN) {
            throw new Error("CircuitBreaker is OPEN. Call blocked.");
        }
        try {
            const result = await fn();
            this.recordRequest(true);
            if (this.state === CircuitState.HALF_OPEN) {
                this.transitionTo(CircuitState.CLOSED);
            }
            return result;
        }
        catch (error) {
            this.recordRequest(false);
            this.evaluateFailure();
            throw error;
        }
    }
    recordRequest(success) {
        const now = Date.now();
        this.requestHistory.push({ timestamp: now, success });
        this.cleanHistory(now);
    }
    cleanHistory(now) {
        this.requestHistory = this.requestHistory.filter(r => now - r.timestamp <= this.windowMs);
    }
    evaluateFailure() {
        const now = Date.now();
        this.cleanHistory(now);
        if (this.state === CircuitState.CLOSED) {
            if (this.requestHistory.length >= this.minRequests) {
                const failures = this.requestHistory.filter(r => !r.success).length;
                const failureRate = failures / this.requestHistory.length;
                if (failureRate > this.failureRateThreshold) {
                    this.transitionTo(CircuitState.OPEN);
                }
            }
        }
        else if (this.state === CircuitState.HALF_OPEN) {
            // Any failure in HALF_OPEN trips it back to OPEN immediately
            this.transitionTo(CircuitState.OPEN);
        }
    }
    // Force state change (useful for testing)
    forceOpen() {
        this.transitionTo(CircuitState.OPEN);
    }
}
exports.CircuitBreaker = CircuitBreaker;
