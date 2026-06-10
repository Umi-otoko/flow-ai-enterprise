export interface BackoffConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  maxAttempts: number;
  jitterFactor: number;
}

const DEFAULTS: BackoffConfig = {
  baseDelayMs: 60_000,
  maxDelayMs: 600_000,
  multiplier: 2,
  maxAttempts: 6,
  jitterFactor: 0.2,
};

export class BackoffManager {
  private attempt = 0;
  private cfg: BackoffConfig;

  constructor(config: Partial<BackoffConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  /** Returns delay in ms for the current attempt, then increments the counter. */
  nextDelay(): number {
    const { baseDelayMs, maxDelayMs, multiplier, jitterFactor } = this.cfg;
    const exponential = baseDelayMs * Math.pow(multiplier, this.attempt);
    const capped = Math.min(exponential, maxDelayMs);
    const jitter = capped * jitterFactor * (Math.random() * 2 - 1);
    const delay = Math.round(Math.max(capped + jitter, baseDelayMs));
    this.attempt = Math.min(this.attempt + 1, this.cfg.maxAttempts);
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }

  hasExceededMax(): boolean {
    return this.attempt >= this.cfg.maxAttempts;
  }

  getAttempt(): number {
    return this.attempt;
  }

  getReadableDelay(): string {
    const { baseDelayMs, maxDelayMs, multiplier } = this.cfg;
    const ms = Math.min(baseDelayMs * Math.pow(multiplier, this.attempt), maxDelayMs);
    return ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`;
  }
}
