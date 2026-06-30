"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = void 0;
class CircuitBreaker {
    constructor(threshold = 3, cooldownMs = 30000) {
        this.threshold = threshold;
        this.cooldownMs = cooldownMs;
        this.failures = 0;
        this.openUntil = 0;
    }
    get isOpen() {
        return Date.now() < this.openUntil;
    }
    get failuresCount() {
        return this.failures;
    }
    canRequest() {
        return !this.isOpen;
    }
    recordSuccess() {
        this.failures = 0;
        this.openUntil = 0;
    }
    recordFailure() {
        this.failures += 1;
        if (this.failures >= this.threshold) {
            this.openUntil = Date.now() + this.cooldownMs;
        }
    }
    reset() {
        this.failures = 0;
        this.openUntil = 0;
    }
}
exports.CircuitBreaker = CircuitBreaker;
