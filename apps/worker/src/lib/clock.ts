/** A clock that the mock adapters replay against. Real adapters use the system clock. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Simulated clock: starts at `start` and advances `speed` times faster than
 * real time. Can also be set or advanced manually (tests).
 */
export class SimClock implements Clock {
  private baseSim: number;
  private baseReal: number;

  constructor(
    start: Date,
    private speed = 1,
    private readonly realNow: () => number = Date.now,
  ) {
    this.baseSim = start.getTime();
    this.baseReal = realNow();
  }

  now(): Date {
    return new Date(this.baseSim + (this.realNow() - this.baseReal) * this.speed);
  }

  set(instant: Date): void {
    this.baseSim = instant.getTime();
    this.baseReal = this.realNow();
  }

  advance(ms: number): void {
    this.set(new Date(this.now().getTime() + ms));
  }

  setSpeed(speed: number): void {
    this.set(this.now());
    this.speed = speed;
  }
}
