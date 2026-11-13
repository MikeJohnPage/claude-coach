import "./style.css";
import { drawGauge } from "./app/gauge";
import { clearOverlay, drawOverlay } from "./app/overlay";
import { PoseEngine } from "./app/pose";
import { TraceRecorder } from "./app/recorder";
import { Speaker } from "./app/speech";
import { defaultConfig as config } from "./pipeline/config";
import type { Rotation } from "./pipeline/rotate";
import { CoachSession } from "./pipeline/session";
import type { CoachEvent, FrameOutput, PoseFrame, SessionState } from "./pipeline/types";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("video");
const overlay = $<HTMLCanvasElement>("overlay");
const gauge = $<HTMLCanvasElement>("gauge");
const startButton = $<HTMLButtonElement>("start");
const restartButton = $<HTMLButtonElement>("restart");
const intro = $("intro");
const recalibrateButton = $<HTMLButtonElement>("recalibrate");
const stateEl = $("state");
const detailEl = $("detail");
const angleEl = $("angle");
const saidEl = $("said");
const settingsToggle = $<HTMLButtonElement>("settings-toggle");
const settingsClose = $<HTMLButtonElement>("settings-close");
const debugPanel = $("settings");
const voiceSelect = $<HTMLSelectElement>("voice");
const voiceTest = $<HTMLButtonElement>("voice-test");
const variantSelect = $<HTMLSelectElement>("variant");
const sourceSelect = $<HTMLSelectElement>("source");
const fileInput = $<HTMLInputElement>("file");
const rotationSelect = $<HTMLSelectElement>("rotation");
const recordButton = $<HTMLButtonElement>("record");
const downloadButton = $<HTMLButtonElement>("download");
const recordStatus = $("record-status");
const debugValues = $<HTMLTableElement>("debug-values");
const debugVisibility = $<HTMLTableElement>("debug-visibility");
const debugEvents = $("debug-events");

const engine = new PoseEngine();
const speaker = new Speaker();
const recorder = new TraceRecorder();

let session = new CoachSession(config);
let running = false;
let stream: MediaStream | null = null;
let fileUrl: string | null = null;
let modelLoading: Promise<void> | null = null;
let lastVideoTime = -1;
let lastFrame: PoseFrame | null = null;
let lastOutput: FrameOutput | null = null;
let frameCount = 0;
let fps = 0;
let inferenceMs = 0;
let lastFrameWall = 0;
let lastDebugPaint = 0;
let lastSaid = "";
const eventLog: string[] = [];

// Read by the browser smoke test.
const status = { modelReady: false, delegate: "", frames: 0, state: "idle", said: [] as string[], error: "" };
(window as unknown as { __coach: typeof status }).__coach = status;

const STATE_LABEL: Record<SessionState, string> = { calibrating: "Hold still", active: "Go", lost: "Can't see you" };
const AUTO_VOICE = "";

function showState(kind: SessionState | "idle" | "error", label: string, detail: string): void {
  document.body.dataset.state = kind;
  stateEl.textContent = label;
  detailEl.textContent = detail;
  status.state = kind;
}

function showError(message: string, error: unknown): void {
  console.error(message, error);
  status.error = message;
  showState("error", message, error instanceof Error ? error.message : String(error));
}

function say(text: string, kind: "prompt" | "cue"): void {
  speaker.speak(text, kind);
  status.said.push(text);
  lastSaid = text;
  saidEl.textContent = text;
}

function loadModel(variant: string, forceCpu = false): Promise<void> {
  status.modelReady = false;
  modelLoading = engine
    .load(variant, forceCpu)
    .then(() => {
      status.modelReady = true;
      status.delegate = engine.delegate ?? "";
    })
    .catch((error: unknown) => {
      modelLoading = null;
      showError(`Could not load the ${variant} model. Run "npm run models" once to download it.`, error);
      throw error;
    });
  return modelLoading;
}

function resetSession(): void {
  session = new CoachSession(config);
  lastOutput = null;
  lastVideoTime = -1;
  saidEl.textContent = "";
}

function stopSource(): void {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
  video.removeAttribute("src");
}

async function startSource(): Promise<void> {
  stopSource();
  if (sourceSelect.value === "file") {
    if (!fileUrl) throw new Error("Choose a video file first.");
    video.src = fileUrl;
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    });
    video.srcObject = stream;
  }
  await video.play();
}

async function start(): Promise<void> {
  // Speaking inside the click handler is what unlocks speech for the rest of the session.
  say(config.phrases.start, "prompt");
  startButton.disabled = true;
  restartButton.disabled = true;
  running = false;
  status.error = "";
  showState("calibrating", "Starting", "Loading the pose model and the camera");
  try {
    await (modelLoading ?? loadModel(variantSelect.value));
    await startSource();
  } catch (error) {
    if (!status.error) showError("Could not start", error);
    startButton.disabled = false;
    restartButton.disabled = false;
    return;
  }
  resetSession();
  running = true;
  recalibrateButton.disabled = false;
  intro.hidden = true;
  restartButton.hidden = false;
  startButton.disabled = false;
  restartButton.disabled = false;
}

function handleEvents(events: CoachEvent[]): void {
  for (const event of events) {
    if (event.type === "speak") say(event.text, event.kind);
    eventLog.push(`${(event.t / 1000).toFixed(2)}s ${event.type}${"id" in event ? ` ${event.id}` : ""}${event.type === "repEnd" ? (event.clean ? " clean" : " cued") : ""}`);
  }
  if (eventLog.length > 12) eventLog.splice(0, eventLog.length - 12);
}

function render(frame: PoseFrame, output: FrameOutput): void {
  drawOverlay(overlay, frame, output.topSide, config);
  const m = output.measurements;
  const detail =
    output.state === "active"
      ? `${output.topSide} leg on top`
      : output.state === "calibrating" && output.calibrationProgress > 0
        ? `${output.detail} ${Math.round(output.calibrationProgress * 100)}%`
        : output.detail;
  showState(output.state, STATE_LABEL[output.state], detail);
  drawGauge(gauge, m ? m.abduction : null, config);
  angleEl.textContent = m ? `${Math.round(m.abduction)}°` : "";
  angleEl.classList.toggle("over", m !== null && m.abduction > config.abduction.limitDeg + config.abduction.toleranceDeg);
}

const fmt = (v: number | undefined | null, digits = 1): string => (v === undefined || v === null ? "–" : v.toFixed(digits));

function renderDebug(): void {
  const o = lastOutput;
  const m = o?.measurements;
  const cal = o?.calibration;
  const rows: Array<[string, string]> = [
    ["state", o?.state ?? status.state],
    ["top side", o?.topSide ?? "–"],
    ["A towards camera", m ? (m.anteriorTowardCamera ? "yes" : "NO") : "–"],
    ["abduction (°)", fmt(m?.abduction)],
    ["abductionPelvis (°)", fmt(m?.abductionPelvis)],
    ["flexion (°)", fmt(m?.flexion)],
    ["flexDrift (°)", fmt(m?.flexDrift)],
    ["pelvisRoll (°)", fmt(m?.pelvisRoll)],
    ["trunkRoll (°)", fmt(m?.trunkRoll)],
    ["torsoShift", fmt(m?.torsoShift, 3)],
    ["rest abduction (°)", fmt(cal?.restAbduction)],
    ["baseline flexion (°)", fmt(cal?.flexion)],
    ["baseline pelvis roll (°)", fmt(cal?.pelvisRoll)],
    ["rep phase", o?.repPhase ?? "–"],
    ["FPS", fmt(fps)],
    ["inference (ms)", fmt(inferenceMs)],
    ["model", `${engine.variant ?? "–"} on ${engine.delegate ?? "–"}`],
    ["frame", lastFrame ? `${lastFrame.width}×${lastFrame.height}` : "–"],
    ["voice", speaker.voice()?.name ?? "–"],
    ["last said", lastSaid || "–"],
  ];
  debugValues.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  const lm = lastFrame?.landmarks;
  debugVisibility.innerHTML =
    "<tr><td>visibility</td><td></td></tr>" +
    Object.entries(config.landmarks)
      .map(([name, i]) => `<tr><td>${name}</td><td>${lm ? fmt(lm[i]?.visibility, 2) : "–"}</td></tr>`)
      .join("");
  debugEvents.textContent = eventLog.join("\n");
  recordStatus.textContent = recorder.recording || recorder.frameCount ? `${recorder.frameCount} frames` : "";
}

function processFrame(now: number): void {
  const rotation = Number(rotationSelect.value) as Rotation;
  const before = performance.now();
  const detected = engine.detect(video, now, rotation);
  inferenceMs += 0.1 * (performance.now() - before - inferenceMs);
  // A replayed clip is timed by its own clock, so a slow machine does not change the result.
  const t = sourceSelect.value === "file" ? video.currentTime * 1000 : now;
  const frame: PoseFrame = { t, ...detected };
  const output = session.process(frame);
  recorder.add(frame, output);
  handleEvents(output.events);
  render(frame, output);
  lastFrame = frame;
  lastOutput = output;
  frameCount += 1;
  status.frames = frameCount;
  if (lastFrameWall) fps += 0.1 * (1000 / (now - lastFrameWall) - fps);
  lastFrameWall = now;
}

function loop(now: number): void {
  if (running && engine.ready && video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      processFrame(now);
    } catch (error) {
      if (engine.delegate === "GPU") {
        // The GPU delegate can initialise and still fail on the first frame.
        console.warn("GPU inference failed, falling back to CPU.", error);
        void loadModel(variantSelect.value, true).catch(() => undefined);
      } else {
        running = false;
        showError("Pose inference failed", error);
      }
    }
  }
  if (!debugPanel.hidden && now - lastDebugPaint > 200) {
    lastDebugPaint = now;
    renderDebug();
  }
  requestAnimationFrame(loop);
}

startButton.addEventListener("click", () => void start());
restartButton.addEventListener("click", () => void start());

recalibrateButton.addEventListener("click", () => {
  session.recalibrate();
  say(config.phrases.start, "prompt");
});

function toggleSettings(open: boolean): void {
  debugPanel.hidden = !open;
  settingsToggle.setAttribute("aria-expanded", String(open));
}
settingsToggle.addEventListener("click", () => toggleSettings(Boolean(debugPanel.hidden)));
settingsClose.addEventListener("click", () => toggleSettings(false));

speaker.onVoicesChanged(() => {
  const chosen = voiceSelect.value || (speaker.chosenName ?? AUTO_VOICE);
  const voices = speaker.voices();
  voiceSelect.replaceChildren(
    new Option(voices.length ? "Automatic" : "No voices available", AUTO_VOICE),
    ...voices.map((v) => new Option(`${v.name}${v.localService ? "" : " (online)"}`, v.name)),
  );
  voiceSelect.value = voices.some((v) => v.name === chosen) ? chosen : AUTO_VOICE;
});
voiceSelect.addEventListener("change", () => {
  speaker.chooseVoice(voiceSelect.value || null);
  say(config.phrases.ready, "prompt");
});
voiceTest.addEventListener("click", () => say(config.phrases.ready, "prompt"));

for (const variant of config.model.variants) variantSelect.add(new Option(variant, variant, false, variant === config.model.defaultVariant));
variantSelect.addEventListener("change", () => {
  void loadModel(variantSelect.value)
    .then(() => session.recalibrate())
    .catch(() => undefined);
});

rotationSelect.addEventListener("change", () => session.recalibrate());

sourceSelect.addEventListener("change", () => {
  fileInput.hidden = sourceSelect.value !== "file";
  if (sourceSelect.value === "webcam" && running) void start();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  fileUrl = URL.createObjectURL(file);
  if (running) void start();
});

video.addEventListener("ended", () => {
  running = false;
  clearOverlay(overlay);
  showState("idle", "Clip ended", "Restart to replay it.");
});

recordButton.addEventListener("click", () => {
  if (recorder.recording) {
    recorder.stop();
    recordButton.textContent = "Record";
    downloadButton.disabled = recorder.frameCount === 0;
  } else {
    recorder.start({
      variant: engine.variant,
      delegate: engine.delegate,
      rotation: Number(rotationSelect.value),
      source: sourceSelect.value,
      userAgent: navigator.userAgent,
    });
    recordButton.textContent = "Stop";
    downloadButton.disabled = true;
  }
});

downloadButton.addEventListener("click", () => recorder.download(config));

drawGauge(gauge, null, config);
void loadModel(variantSelect.value).catch(() => undefined);
requestAnimationFrame(loop);
