"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const circuitBreaker_1 = require("../utils/circuitBreaker");
describe('CircuitBreaker', () => {
    let breaker;
    beforeEach(() => {
        breaker = new circuitBreaker_1.CircuitBreaker(3, 1000);
    });
    describe('initial state', () => {
        it('should start closed', () => {
            expect(breaker.isOpen).toBe(false);
            expect(breaker.canRequest()).toBe(true);
            expect(breaker.failuresCount).toBe(0);
        });
    });
    describe('recordFailure', () => {
        it('should increment failure count', () => {
            breaker.recordFailure();
            expect(breaker.failuresCount).toBe(1);
        });
        it('should open circuit after threshold', () => {
            breaker.recordFailure();
            breaker.recordFailure();
            breaker.recordFailure();
            expect(breaker.isOpen).toBe(true);
            expect(breaker.canRequest()).toBe(false);
        });
    });
    describe('recordSuccess', () => {
        it('should reset failure count', () => {
            breaker.recordFailure();
            breaker.recordFailure();
            breaker.recordSuccess();
            expect(breaker.failuresCount).toBe(0);
        });
    });
    describe('reset', () => {
        it('should reset all state', () => {
            breaker.recordFailure();
            breaker.recordFailure();
            breaker.recordFailure();
            breaker.reset();
            expect(breaker.failuresCount).toBe(0);
            expect(breaker.isOpen).toBe(false);
        });
    });
});
