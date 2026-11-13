import type { CoachConfig } from "./config";

export type RepPhase = "rest" | "up";

/** Rep detection on abduction with hysteresis around the resting angle. */
export class RepDetector {
  phase: RepPhase = "rest";

  constructor(private readonly config: CoachConfig) {}

  reset(): void {
    this.phase = "rest";
  }

  update(abduction: number, restAbduction: number): "start" | "end" | null {
    const { startAboveRestDeg, endAboveRestDeg } = this.config.reps;
    if (this.phase === "rest" && abduction > restAbduction + startAboveRestDeg) {
      this.phase = "up";
      return "start";
    }
    if (this.phase === "up" && abduction <= restAbduction + endAboveRestDeg) {
      this.phase = "rest";
      return "end";
    }
    return null;
  }
}
