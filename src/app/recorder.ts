import type { CoachConfig } from "../pipeline/config";
import { encodeFrame, TRACE_VERSION, type Trace, type TraceFrame } from "../pipeline/trace";
import type { FrameOutput, PoseFrame } from "../pipeline/types";

/** Collects per-frame landmarks, measurements and events in memory and downloads them as JSON. No video is kept. */
export class TraceRecorder {
  recording = false;
  private frames: TraceFrame[] = [];
  private meta: Record<string, unknown> = {};

  get frameCount(): number {
    return this.frames.length;
  }

  start(meta: Record<string, unknown>): void {
    this.frames = [];
    this.meta = { ...meta, startedAt: new Date().toISOString() };
    this.recording = true;
  }

  add(frame: PoseFrame, output: FrameOutput): void {
    if (this.recording) this.frames.push(encodeFrame(frame, output));
  }

  stop(): void {
    this.recording = false;
  }

  download(config: CoachConfig): void {
    const trace: Trace = { version: TRACE_VERSION, meta: this.meta, config, frames: this.frames };
    const url = URL.createObjectURL(new Blob([JSON.stringify(trace)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `hip-abduction-${String(this.meta.startedAt).replace(/[:.]/g, "-")}.trace.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
