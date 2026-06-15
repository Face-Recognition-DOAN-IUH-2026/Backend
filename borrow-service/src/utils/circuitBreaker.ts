export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private threshold = 3,
    private cooldownMs = 30_000,
  ) {}

  canRequest() {
    if (Date.now() >= this.openUntil) return true;
    return false;
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
}
