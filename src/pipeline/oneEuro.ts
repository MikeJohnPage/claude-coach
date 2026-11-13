// One Euro filter (Casiez, Roussel, Vogel 2012): a low-pass filter whose cutoff rises with speed,
// so slow movement is smoothed and fast movement is followed with little lag.

export interface OneEuroParams {
  minCutoffHz: number;
  beta: number;
  dCutoffHz: number;
}

function alpha(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT = 0;

  constructor(private readonly params: OneEuroParams) {}

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  /** `tMs` is in milliseconds. A timestamp that does not advance returns the previous output. */
  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.lastT = tMs;
      return value;
    }
    const dt = (tMs - this.lastT) / 1000;
    if (dt <= 0) return this.x;
    this.lastT = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.params.dCutoffHz, dt) * (rawDx - this.dx);
    const cutoff = this.params.minCutoffHz + this.params.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}
