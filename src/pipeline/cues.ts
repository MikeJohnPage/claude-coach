import type { CoachConfig, CueConfig, CueMeasure } from "./config";

/**
 * Decides which cue, if any, to speak on a frame.
 * A condition must hold without interruption for its persistence time.
 * Each cue fires at most once per rep and at most once per cooldown,
 * and any two cues are separated by a minimum gap.
 * Nothing is queued: a cue that loses to a higher-priority one fires later only if its condition still holds.
 */
export class CueEngine {
  private since = new Map<string, number>();
  private lastFired = new Map<string, number>();
  private firedThisRep = new Set<string>();
  private lastAny = -Infinity;

  constructor(private readonly config: CoachConfig) {}

  reset(): void {
    this.since.clear();
    this.lastFired.clear();
    this.firedThisRep.clear();
    this.lastAny = -Infinity;
  }

  startRep(): void {
    this.firedThisRep.clear();
    this.since.clear();
  }

  endRep(): void {
    this.since.clear();
  }

  update(t: number, values: Record<CueMeasure, number>): CueConfig | null {
    let winner: CueConfig | null = null;
    for (const cue of this.config.cues) {
      if (!(values[cue.measure] > cue.threshold)) {
        this.since.delete(cue.id);
        continue;
      }
      if (!this.since.has(cue.id)) this.since.set(cue.id, t);
      if (winner) continue;
      const persisted = t - this.since.get(cue.id)! >= cue.persistMs;
      const cooledDown = t - (this.lastFired.get(cue.id) ?? -Infinity) >= this.config.cueCooldownMs;
      const gapPassed = t - this.lastAny >= this.config.cueMinGapMs;
      if (persisted && cooledDown && gapPassed && !this.firedThisRep.has(cue.id)) winner = cue;
    }
    if (winner) {
      this.lastFired.set(winner.id, t);
      this.firedThisRep.add(winner.id);
      this.lastAny = t;
    }
    return winner;
  }
}
