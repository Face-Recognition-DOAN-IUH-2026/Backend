export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private threshold = 3,
    private cooldownMs = 30_000,
  ) {}

  get isOpen(): boolean {
    return Date.now() < this.openUntil;
  }

  get failuresCount(): number {
    return this.failures;
  }

  canRequest(): boolean {
    return !this.isOpen;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openUntil = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openUntil = Date.now() + this.cooldownMs;
    }
  }

  reset(): void {
    this.failures = 0;
    this.openUntil = 0;
  }
}
