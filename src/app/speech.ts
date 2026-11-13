export type SpeechKind = "prompt" | "cue";

const STORAGE_KEY = "coach.voice";

// Calmer than the default delivery.
const RATE = 0.92;
const PITCH = 1;

// Names that mark a voice as one of the natural-sounding ones the platforms ship.
const NATURAL = /natural|neural|premium|enhanced|siri/i;
const PLEASANT = /samantha|ava|allison|serena|karen|moira|tessa|fiona|zoe|susan|aria|jenny|libby|sonia|google uk english female/i;
// Formant synthesisers and the macOS novelty voices.
const ROBOTIC =
  /espeak|compact|albert|bad news|bahh|bells|boing|bubbles|cellos|fred|junior|ralph|trinoids|whisper|zarvox|wobble|jester|organ|superstar|good news|kathy|princess|deranged|hysterical|pipe/i;

function score(voice: SpeechSynthesisVoice): number {
  let s = 0;
  if (NATURAL.test(voice.name)) s += 100;
  if (PLEASANT.test(voice.name)) s += 50;
  if (ROBOTIC.test(voice.name)) s -= 200;
  if (voice.lang === "en-GB" || voice.lang === "en-US") s += 5;
  return s;
}

/**
 * Speaks one utterance at a time and never queues: a prompt interrupts anything,
 * and a cue that arrives while speech is in progress is dropped.
 *
 * The voice is the best English one the browser offers.
 * By default only voices that run on the device are considered; an online voice is used only when chosen by name.
 */
export class Speaker {
  private readonly synth: SpeechSynthesis | null = "speechSynthesis" in window ? window.speechSynthesis : null;
  private current: SpeechSynthesisUtterance | null = null;
  private chosen: string | null = null;

  constructor() {
    try {
      this.chosen = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable; the automatic choice is used then.
    }
  }

  /** English voices, best first. */
  voices(): SpeechSynthesisVoice[] {
    const all = this.synth?.getVoices() ?? [];
    return all.filter((v) => v.lang.toLowerCase().startsWith("en")).sort((a, b) => score(b) - score(a));
  }

  /** Calls back now and whenever the browser's voice list changes; Chromium fills it asynchronously. */
  onVoicesChanged(callback: () => void): void {
    this.synth?.addEventListener("voiceschanged", callback);
    callback();
  }

  /** The voice that will be used: the chosen one if it exists, otherwise the best on-device one. */
  voice(): SpeechSynthesisVoice | null {
    const voices = this.voices();
    return voices.find((v) => v.name === this.chosen) ?? voices.find((v) => v.localService) ?? voices[0] ?? null;
  }

  /** The name picked by the user, if any. */
  get chosenName(): string | null {
    return this.chosen;
  }

  /** Pass null to return to the automatic choice. */
  chooseVoice(name: string | null): void {
    this.chosen = name;
    try {
      if (name) localStorage.setItem(STORAGE_KEY, name);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The choice then lasts until the page is closed.
    }
  }

  /** Returns false when the utterance was dropped. */
  speak(text: string, kind: SpeechKind): boolean {
    const synth = this.synth;
    if (!synth) return false;
    if (this.current) {
      if (kind === "cue") return false;
      synth.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.voice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-US";
    utterance.rate = RATE;
    utterance.pitch = PITCH;
    const done = (): void => {
      if (this.current === utterance) this.current = null;
    };
    utterance.onend = done;
    utterance.onerror = done;
    // Holding the utterance also stops some browsers collecting it before `onend`.
    this.current = utterance;
    synth.speak(utterance);
    return true;
  }
}
