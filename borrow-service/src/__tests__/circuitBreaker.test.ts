import { CircuitBreaker } from '../../../shared/utils/circuitBreaker';

describe('CircuitBreaker', () => {
  describe('initial state', () => {
    it('should be closed by default', () => {
      const cb = new CircuitBreaker(3, 60000);
      expect(cb.isOpen).toBe(false);
      expect(cb.failuresCount).toBe(0);
    });

    it('should allow requests when closed', () => {
      const cb = new CircuitBreaker(3, 60000);
      expect(cb.canRequest()).toBe(true);
    });

    it('should have zero failures initially', () => {
      const cb = new CircuitBreaker(3, 60000);
      expect(cb.failuresCount).toBe(0);
    });
  });

  describe('recordFailure', () => {
    it('should increment failure count', () => {
      const cb = new CircuitBreaker(3, 60000);
      cb.recordFailure();
      expect(cb.failuresCount).toBe(1);
    });

    it('should open circuit after threshold failures', () => {
      const cb = new CircuitBreaker(3, 60000);
      cb.recordFailure();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isOpen).toBe(true);
    });

    it('should block requests when open', () => {
      const cb = new CircuitBreaker(2, 60000);
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.canRequest()).toBe(false);
    });

    it('should not open circuit below threshold', () => {
      const cb = new CircuitBreaker(3, 60000);
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isOpen).toBe(false);
    });

    it('should reopen after reset and new failures', () => {
      const cb = new CircuitBreaker(2, 60000);
      cb.recordFailure();
      cb.recordSuccess();
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isOpen).toBe(true);
    });
  });

  describe('recordSuccess', () => {
    it('should reset failure count on success', () => {
      const cb = new CircuitBreaker(3, 60000);
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();
      expect(cb.failuresCount).toBe(0);
    });

    it('should keep circuit closed after success', () => {
      const cb = new CircuitBreaker(3, 60000);
      cb.recordSuccess();
      expect(cb.isOpen).toBe(false);
    });

    it('should reset circuit to closed state', () => {
      const cb = new CircuitBreaker(1, 60000);
      cb.recordFailure();
      expect(cb.isOpen).toBe(true);
      cb.recordSuccess();
      expect(cb.isOpen).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset failure count', () => {
      const cb = new CircuitBreaker(1, 60000);
      cb.recordFailure();
      expect(cb.failuresCount).toBe(1);
      cb.reset();
      expect(cb.failuresCount).toBe(0);
    });

    it('should close open circuit', () => {
      const cb = new CircuitBreaker(1, 60000);
      cb.recordFailure();
      expect(cb.isOpen).toBe(true);
      cb.reset();
      expect(cb.isOpen).toBe(false);
    });

    it('should allow requests after reset', () => {
      const cb = new CircuitBreaker(1, 60000);
      cb.recordFailure();
      cb.reset();
      expect(cb.canRequest()).toBe(true);
    });
  });

  describe('concurrent failures', () => {
    it('should handle concurrent failure recordings', async () => {
      const cb = new CircuitBreaker(3, 60000);
      const promises = [1, 2, 3].map(() => cb.recordFailure());
      await Promise.all(promises);
      expect(cb.isOpen).toBe(true);
    });
  });

  describe('high threshold', () => {
    it('should not open on single failure with high threshold', () => {
      const cb = new CircuitBreaker(10, 60000);
      cb.recordFailure();
      expect(cb.isOpen).toBe(false);
    });
  });

  describe('half-open after cooldown', () => {
    it('should transition to half-open after cooldown expires', async () => {
      const cb = new CircuitBreaker(1, 100);
      cb.recordFailure();
      expect(cb.isOpen).toBe(true);
      expect(cb.canRequest()).toBe(false);
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cb.canRequest()).toBe(true);
      expect(cb.isOpen).toBe(false);
    });
  });
});

describe('CircuitBreaker instances', () => {
  it('should have independent failure counters', () => {
    const cb1 = new CircuitBreaker(3, 60000);
    const cb2 = new CircuitBreaker(3, 60000);
    cb1.recordFailure();
    cb1.recordFailure();
    expect(cb1.failuresCount).toBe(2);
    expect(cb2.failuresCount).toBe(0);
  });

  it('should have independent open states', () => {
    const cb1 = new CircuitBreaker(1, 60000);
    const cb2 = new CircuitBreaker(3, 60000);
    cb1.recordFailure();
    expect(cb1.isOpen).toBe(true);
    expect(cb2.isOpen).toBe(false);
  });

  it('should have independent cooldown settings', () => {
    const cb1 = new CircuitBreaker(1, 100);
    const cb2 = new CircuitBreaker(1, 60000);
    cb1.recordFailure();
    cb2.recordFailure();
    expect(cb1.isOpen).toBe(true);
    expect(cb2.isOpen).toBe(true);
  });
});