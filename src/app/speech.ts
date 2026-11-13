export type SpeechKind = "prompt" | "cue" | "rep";

const RANK: Record<SpeechKind, number> = { rep: 1, cue: 2, prompt: 3 };

/**
 * Speaks one utterance at a time and never queues.
 * A prompt interrupts anything, a cue interrupts a rep number, a rep number replaces an older rep number,
 * and anything else that arrives while speech is in progress is dropped.
 */
export class Speaker {
  private currentRank = 0;
  private readonly synth: SpeechSynthesis | null = "speechSynthesis" in window ? window.speechSynthesis : null;

  get available(): boolean {
    return this.synth !== null;
  }

  /** Returns false when the utterance was dropped. */
  speak(text: string, kind: SpeechKind): boolean {
    const synth = this.synth;
    if (!synth) return false;
    const rank = RANK[kind];
    if (this.currentRank > 0) {
      const replaces = rank > this.currentRank || kind !== "cue";
      if (!replaces) return false;
      synth.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    const done = (): void => {
      if (this.current === utterance) {
        this.current = null;
        this.currentRank = 0;
      }
    };
    utterance.onend = done;
    utterance.onerror = done;
    this.current = utterance;
    this.currentRank = rank;
    synth.speak(utterance);
    return true;
  }

  stop(): void {
    this.synth?.cancel();
    this.current = null;
    this.currentRank = 0;
  }

  // Also keeps a reference to the utterance, which some browsers otherwise garbage-collect before `onend`.
  private current: SpeechSynthesisUtterance | null = null;
}
